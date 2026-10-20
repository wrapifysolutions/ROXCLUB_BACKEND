const crypto = require('node:crypto');
const { starvaConfig, assertStravaConfig } = require('../../lib/starvaConfig/staravaConfig');
const { exchangeAuthorizationCode, deauthorize } = require('../../lib/strava/stravaClient');
const {
    ensureStravaTables,
    saveStravaConnection,
    markStravaError,
    getStravaIntegration,
    getValidAccessToken,
    disconnectStrava,
} = require('../../lib/strava/stravaTokens');
const pool = require('../../lib/pool');

async function createOAuthState(userId) {
    await ensureStravaTables();

    await pool.query(`DELETE FROM oauth_states WHERE expires_at < NOW()`);

    const state = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(
        Date.now() + starvaConfig.stateTtlMinutes * 60 * 1000
    );

    await pool.query(
        `
        INSERT INTO oauth_states (state, user_id, provider, expires_at)
        VALUES ($1, $2, 'strava', $3)
        `,
        [state, userId, expiresAt]
    );

    return state;
}

async function consumeOAuthState(state) {
    await ensureStravaTables();

    const { rows } = await pool.query(
        `
        DELETE FROM oauth_states
        WHERE state = $1
          AND provider = 'strava'
          AND expires_at > NOW()
        RETURNING user_id
        `,
        [state]
    );

    return rows[0]?.user_id || null;
}

function redirectWithStatus(res, baseUrl, params = {}) {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value != null) {
            url.searchParams.set(key, String(value));
        }
    });
    return res.redirect(url.toString());
}

const connectStrava = async (req, res) => {
    try {
        assertStravaConfig();

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized Access',
            });
        }

        const state = await createOAuthState(userId);
        const url = new URL(starvaConfig.authorizationUrl);

        url.searchParams.set('client_id', starvaConfig.clientId);
        url.searchParams.set('redirect_uri', starvaConfig.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('scope', starvaConfig.scope);
        url.searchParams.set('approval_prompt', 'auto');
        url.searchParams.set('state', state);

        return res.status(200).json({
            success: true,
            authorizationUrl: url.toString(),
        });
    } catch (error) {
        console.error('Strava connect error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Unable to connect to Strava',
        });
    }
};

const stravaCallback = async (req, res) => {
    const { code, state, error, scope } = req.query;

    try {
        assertStravaConfig();

        if (error) {
            return redirectWithStatus(res, starvaConfig.frontendErrorUrl, {
                reason: error,
            });
        }

        if (!code || !state) {
            return redirectWithStatus(res, starvaConfig.frontendErrorUrl, {
                reason: 'missing_code_or_state',
            });
        }

        const userId = await consumeOAuthState(String(state));
        if (!userId) {
            return redirectWithStatus(res, starvaConfig.frontendErrorUrl, {
                reason: 'invalid_or_expired_state',
            });
        }

        const grantedScope = String(scope || '');
        if (
            !grantedScope.includes('activity:read_all') &&
            !grantedScope.includes('activity:read')
        ) {
            await markStravaError(userId, 'Required activity read scope was not granted');
            return redirectWithStatus(res, starvaConfig.frontendErrorUrl, {
                reason: 'missing_activity_scope',
            });
        }

        const tokenPayload = await exchangeAuthorizationCode(String(code));
        await saveStravaConnection(userId, tokenPayload);

        return redirectWithStatus(res, starvaConfig.frontendSuccessUrl, {
            provider: 'strava',
        });
    } catch (err) {
        console.error('Strava callback error:', err);
        return redirectWithStatus(res, starvaConfig.frontendErrorUrl, {
            reason: 'callback_failed',
        });
    }
};

const getStravaStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getStravaIntegration(userId);

        if (!integration) {
            return res.status(200).json({
                success: true,
                connected: false,
                status: 'disconnected',
            });
        }

        return res.status(200).json({
            success: true,
            connected: integration.status === 'connected',
            status: integration.status,
            providerUserId: integration.provider_user_id,
            tokenExpiresAt: integration.token_expires_at,
            connectedAt: integration.connected_at,
            lastError: integration.last_error,
        });
    } catch (error) {
        console.error('Strava status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Strava status',
        });
    }
};

const disconnectStravaAccount = async (req, res) => {
    try {
        assertStravaConfig();

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getStravaIntegration(userId);

        if (integration?.status === 'connected' && integration.access_token_encrypted) {
            try {
                const accessToken = await getValidAccessToken(userId);
                await deauthorize(accessToken);
            } catch (revokeError) {
                // Still clear local tokens if Strava revoke fails.
                console.warn('Strava deauthorize warning:', revokeError.message);
            }
        }

        await disconnectStrava(userId);

        return res.status(200).json({
            success: true,
            message: 'Strava disconnected',
        });
    } catch (error) {
        console.error('Strava disconnect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to disconnect Strava',
        });
    }
};

module.exports = {
    connectStrava,
    stravaCallback,
    getStravaStatus,
    disconnectStravaAccount,
};
