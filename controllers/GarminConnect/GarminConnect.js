const { garminConfig, assertGarminConfig, getGarminAvailability } = require('../../lib/garmin/garminConfig');
const {
    generatePkce,
    exchangeAuthorizationCode,
    fetchGarminUserId,
    deregisterGarminUser,
} = require('../../lib/garmin/garminClient');
const {
    createGarminOAuthState,
    consumeGarminOAuthState,
    saveGarminConnection,
    markGarminError,
    getGarminIntegration,
    getValidGarminAccessToken,
    disconnectGarmin,
} = require('../../lib/garmin/garminTokens');
const { countGarminSamples } = require('../../lib/garmin/garminDataStore');

function redirectWithStatus(res, baseUrl, params = {}) {
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
        if (value != null) url.searchParams.set(key, String(value));
    });
    return res.redirect(url.toString());
}

const connectGarmin = async (req, res) => {
    try {
        const availability = getGarminAvailability();
        if (!availability.ready) {
            return res.status(503).json({
                success: false,
                available: false,
                provider: 'garmin',
                message: 'Garmin Connect is not enabled yet. Set approved GARMIN_CLIENT_ID and GARMIN_CLIENT_SECRET.',
                hint: availability.hint,
            });
        }

        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const { codeVerifier, codeChallenge } = generatePkce();
        const state = await createGarminOAuthState(userId, codeVerifier);
        const url = new URL(garminConfig.authorizationUrl);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', garminConfig.clientId);
        url.searchParams.set('code_challenge', codeChallenge);
        url.searchParams.set('code_challenge_method', 'S256');
        url.searchParams.set('redirect_uri', garminConfig.redirectUri);
        url.searchParams.set('state', state);

        return res.status(200).json({
            success: true,
            authorizationUrl: url.toString(),
        });
    } catch (error) {
        console.error('Garmin connect error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Unable to connect to Garmin',
        });
    }
};

const garminCallback = async (req, res) => {
    const { code, state, error } = req.query;
    try {
        assertGarminConfig();
        if (error) {
            return redirectWithStatus(res, garminConfig.frontendErrorUrl, { reason: error });
        }
        if (!code || !state) {
            return redirectWithStatus(res, garminConfig.frontendErrorUrl, { reason: 'missing_code_or_state' });
        }

        const saved = await consumeGarminOAuthState(String(state));
        if (!saved?.user_id || !saved.code_verifier) {
            return redirectWithStatus(res, garminConfig.frontendErrorUrl, {
                reason: 'invalid_or_expired_state',
            });
        }

        const tokenPayload = await exchangeAuthorizationCode({
            code: String(code),
            codeVerifier: saved.code_verifier,
        });
        const providerUserId = await fetchGarminUserId(tokenPayload.access_token);
        await saveGarminConnection(saved.user_id, {
            ...tokenPayload,
            provider_user_id: providerUserId,
        });

        return redirectWithStatus(res, garminConfig.frontendSuccessUrl, { provider: 'garmin' });
    } catch (err) {
        console.error('Garmin callback error:', err);
        return redirectWithStatus(res, garminConfig.frontendErrorUrl, { reason: 'callback_failed' });
    }
};

const getGarminStatus = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getGarminIntegration(userId);
        if (!integration) {
            return res.status(200).json({
                success: true,
                connected: false,
                status: 'disconnected',
                provider: 'garmin',
            });
        }

        const sampleCounts =
            integration.status === 'connected' ? await countGarminSamples(userId).catch(() => ({})) : {};

        return res.status(200).json({
            success: true,
            connected: integration.status === 'connected',
            status: integration.status,
            provider: 'garmin',
            providerUserId: integration.provider_user_id,
            tokenExpiresAt: integration.token_expires_at,
            connectedAt: integration.connected_at,
            lastSyncedAt: integration.last_synced_at,
            lastSyncStatus: integration.last_sync_status,
            sampleCounts,
            lastError: integration.last_error,
            note: 'Starter Garmin apps receive new watch syncs by webhook. History before connect is not pulled.',
        });
    } catch (error) {
        console.error('Garmin status error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to fetch Garmin status',
        });
    }
};

const disconnectGarminAccount = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized Access' });
        }

        const integration = await getGarminIntegration(userId);
        if (integration?.status === 'connected' && integration.access_token_encrypted) {
            try {
                const accessToken = await getValidGarminAccessToken(userId);
                await deregisterGarminUser(accessToken);
            } catch (revokeError) {
                console.warn('Garmin deregister warning:', revokeError.message);
            }
        }

        await disconnectGarmin(userId);
        return res.status(200).json({
            success: true,
            message: 'Garmin disconnected',
        });
    } catch (error) {
        console.error('Garmin disconnect error:', error);
        return res.status(500).json({
            success: false,
            message: 'Unable to disconnect Garmin',
        });
    }
};

module.exports = {
    connectGarmin,
    garminCallback,
    getGarminStatus,
    disconnectGarminAccount,
};
