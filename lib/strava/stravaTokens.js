const pool = require('../pool');
const { encryptToken, decryptToken } = require('../../data/tokenEncryption');
const { refreshAccessToken } = require('./stravaClient');
const {
    createUserIntegrationsTable,
    createOAuthStatesTable,
    createOAuthStatesIndex,
} = require('../../models/StarvaModel/StarvaSchama');

let tablesReady = false;

async function ensureStravaTables() {
    if (tablesReady) {
        return;
    }

    await pool.query(createUserIntegrationsTable);
    await pool.query(createOAuthStatesTable);
    await pool.query(createOAuthStatesIndex);
    tablesReady = true;
}

async function saveStravaConnection(userId, tokenPayload) {
    await ensureStravaTables();

    const accessEncrypted = encryptToken(tokenPayload.access_token);
    const refreshEncrypted = encryptToken(tokenPayload.refresh_token);
    const providerUserId = tokenPayload.athlete?.id
        ? String(tokenPayload.athlete.id)
        : null;
    const expiresAt = new Date(Number(tokenPayload.expires_at) * 1000);

    const { rows } = await pool.query(
        `
        INSERT INTO user_integrations (
            user_id,
            provider,
            provider_user_id,
            access_token_encrypted,
            refresh_token_encrypted,
            token_expires_at,
            status,
            connected_at,
            disconnected_at,
            last_error,
            updated_at
        )
        VALUES ($1, 'strava', $2, $3, $4, $5, 'connected', NOW(), NULL, NULL, NOW())
        ON CONFLICT (user_id, provider)
        DO UPDATE SET
            provider_user_id = EXCLUDED.provider_user_id,
            access_token_encrypted = EXCLUDED.access_token_encrypted,
            refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
            token_expires_at = EXCLUDED.token_expires_at,
            status = 'connected',
            connected_at = NOW(),
            disconnected_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        RETURNING id, user_id, provider, provider_user_id, status, token_expires_at, connected_at
        `,
        [userId, providerUserId, accessEncrypted, refreshEncrypted, expiresAt]
    );

    return rows[0];
}

async function markStravaError(userId, message) {
    await ensureStravaTables();
    await pool.query(
        `
        INSERT INTO user_integrations (user_id, provider, status, last_error, updated_at)
        VALUES ($1, 'strava', 'error', $2, NOW())
        ON CONFLICT (user_id, provider)
        DO UPDATE SET
            status = 'error',
            last_error = EXCLUDED.last_error,
            updated_at = NOW()
        `,
        [userId, message]
    );
}

async function getStravaIntegration(userId) {
    await ensureStravaTables();
    const { rows } = await pool.query(
        `
        SELECT *
        FROM user_integrations
        WHERE user_id = $1 AND provider = 'strava'
        `,
        [userId]
    );
    return rows[0] || null;
}

async function getValidAccessToken(userId) {
    const integration = await getStravaIntegration(userId);

    if (!integration || integration.status !== 'connected') {
        throw new Error('Strava is not connected');
    }

    if (!integration.access_token_encrypted || !integration.refresh_token_encrypted) {
        throw new Error('Strava tokens missing');
    }

    const expiresAtMs = new Date(integration.token_expires_at).getTime();
    const refreshSkewMs = 5 * 60 * 1000;

    if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > refreshSkewMs) {
        return decryptToken(integration.access_token_encrypted);
    }

    const currentRefresh = decryptToken(integration.refresh_token_encrypted);
    const refreshed = await refreshAccessToken(currentRefresh);

    await saveStravaConnection(userId, {
        ...refreshed,
        athlete: { id: integration.provider_user_id },
    });

    return refreshed.access_token;
}

async function disconnectStrava(userId) {
    await ensureStravaTables();
    await pool.query(
        `
        UPDATE user_integrations
        SET
            access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            token_expires_at = NULL,
            status = 'disconnected',
            disconnected_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE user_id = $1 AND provider = 'strava'
        `,
        [userId]
    );
}

module.exports = {
    ensureStravaTables,
    saveStravaConnection,
    markStravaError,
    getStravaIntegration,
    getValidAccessToken,
    disconnectStrava,
};
