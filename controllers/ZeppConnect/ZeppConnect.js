const crypto = require('node:crypto');
const { zeppConfig, assertZeppConfig } = require('../../lib/zeppConfig/zeppConfig');
const { completeZeppTokenExchange } = require('../../lib/zepp/zeppClient');
const {
    ensureZeppTables,
    saveZeppConnection,
    markZeppError,
    getZeppIntegration,
    disconnectZepp,
} = require('../../lib/zepp/zeppTokens');
const pool = require('../../lib/pool');

async function createOAuthState(userId) {
    await ensureZeppTables();
    await pool.query(`DELETE FROM oauth_states WHERE expires_at < NOW()`);

    const state = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + zeppConfig.stateTtlMinutes * 60 * 1000);

    await pool.query(
        `
        INSERT INTO oauth_states (state, user_id, provider, expires_at)
        VALUES ($1, $2, 'zepp', $3)
        `,
        [state, userId, expiresAt]
    );

    return state;
}

async function consumeOAuthState(state) {
    await ensureZeppTables();

    const { rows } = await pool.query(
        `
        DELETE FROM oauth_states
        WHERE state = $1
          AND provider = 'zepp'
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

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

const connectZepp = async (req, res) => {
    try {
        assertZeppConfig();

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized Access',
            });
        }

        const state = await createOAuthState(userId);
        const url = new URL(zeppConfig.xiaomiAuthorizeUrl);

        url.searchParams.set('client_id', zeppConfig.xiaomiClientId);
        url.searchParams.set('redirect_uri', zeppConfig.redirectUri);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('state', state);
        url.searchParams.set('skip_confirm', 'false');

        if (zeppConfig.scope) {
            url.searchParams.set('scope', zeppConfig.scope);
        }

        return res.status(200).json({
            success: true,
            authorizationUrl: url.toString(),
        });
    } catch (error) {
        console.error('Zepp connect error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Unable to connect to Zepp',
        });
    }
};

const zeppCallback = async (req, res) => {
    const { code, state, error, error_description: errorDescription } = req.query;

    try {
        assertZeppConfig();

        if (error) {
            return redirectWithStatus(res, zeppConfig.frontendErrorUrl, {
                reason: error,
                detail: errorDescription,
            });
        }

        if (!code || !state) {
            return redirectWithStatus(res, zeppConfig.frontendErrorUrl, {
                reason: 'missing_code_or_state',
            });
        }

        const userId = await consumeOAuthState(String(state));
        if (!userId) {
            return redirectWithStatus(res, zeppConfig.frontendErrorUrl, {
                reason: 'invalid_or_expired_state',
            });
        }

        const tokenPayload = await completeZeppTokenExchange(
            String(code),
            getClientIp(req)
        );

        if (!tokenPayload.access_token) {
            await markZeppError(userId, 'Zepp token exchange returned empty access token');
            return redirectWithStatus(res, zeppConfig.frontendErrorUrl, {
                reason: 'empty_access_token',
            });
        }

        await saveZeppConnection(userId, tokenPayload);

        return redirectWithStatus(res, zeppConfig.frontendSuccessUrl, {
            provider: 'zepp',
        });
    } catch (err) {
        console.error('Zepp callback error:', err);
        return redirectWithStatus(res, zeppConfig.frontendErrorUrl, {
            reason: 'callback_failed',
        });
    }
};

const getZeppStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getZeppIntegration(userId);

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
        console.error('Zepp status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Zepp status',
        });
    }
};

const disconnectZeppAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        await disconnectZepp(userId);

        return res.status(200).json({
            success: true,
            message: 'Zepp disconnected',
        });
    } catch (error) {
        console.error('Zepp disconnect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to disconnect Zepp',
        });
    }
};

module.exports = {
    connectZepp,
    zeppCallback,
    getZeppStatus,
    disconnectZeppAccount,
};
