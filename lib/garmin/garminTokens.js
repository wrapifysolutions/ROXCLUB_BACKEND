const pool = require('../pool');
const { encryptToken, decryptToken } = require('../../data/tokenEncryption');
const { refreshAccessToken } = require('./garminClient');
const {
    createUserIntegrationsTable,
    createOAuthStatesTable,
    createOAuthStatesIndex,
} = require('../../models/StarvaModel/StarvaSchama');
const { allowGarminProvider } = require('../../models/Garmin/GarminSchema');
const { garminConfig } = require('./garminConfig');

let tablesReady = false;

async function ensureGarminTables() {
    if (tablesReady) return;
    await pool.query(createUserIntegrationsTable);
    await pool.query(createOAuthStatesTable);
    await pool.query(createOAuthStatesIndex);
    await pool.query(allowGarminProvider);
    tablesReady = true;
}

async function createGarminOAuthState(userId, codeVerifier) {
    await ensureGarminTables();
    await pool.query(`DELETE FROM oauth_states WHERE expires_at < NOW()`);
    const state = require('node:crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + garminConfig.stateTtlMinutes * 60 * 1000);
    await pool.query(
        `
        INSERT INTO oauth_states (state, user_id, provider, expires_at, code_verifier)
        VALUES ($1, $2, 'garmin', $3, $4)
        `,
        [state, userId, expiresAt, codeVerifier]
    );
    return state;
}

async function consumeGarminOAuthState(state) {
    await ensureGarminTables();
    const { rows } = await pool.query(
        `
        DELETE FROM oauth_states
        WHERE state = $1
          AND provider = 'garmin'
          AND expires_at > NOW()
        RETURNING user_id, code_verifier
        `,
        [state]
    );
    return rows[0] || null;
}

async function saveGarminConnection(userId, tokenPayload) {
    await ensureGarminTables();
    const expiresAt = new Date(Number(tokenPayload.expires_at) * 1000);
    const { rows } = await pool.query(
        `
        INSERT INTO user_integrations (
            user_id, provider, provider_user_id, access_token_encrypted,
            refresh_token_encrypted, token_expires_at, status, connected_at,
            disconnected_at, last_error, last_sync_status, updated_at
        )
        VALUES ($1, 'garmin', $2, $3, $4, $5, 'connected', NOW(), NULL, NULL, 'pending', NOW())
        ON CONFLICT (user_id, provider)
        DO UPDATE SET
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, user_integrations.provider_user_id),
            access_token_encrypted = EXCLUDED.access_token_encrypted,
            refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
            token_expires_at = EXCLUDED.token_expires_at,
            status = 'connected',
            connected_at = COALESCE(user_integrations.connected_at, NOW()),
            disconnected_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        RETURNING id, user_id, provider, provider_user_id, status, token_expires_at, connected_at
        `,
        [
            userId,
            tokenPayload.provider_user_id ? String(tokenPayload.provider_user_id) : null,
            encryptToken(tokenPayload.access_token),
            encryptToken(tokenPayload.refresh_token),
            expiresAt,
        ]
    );
    return rows[0];
}

async function markGarminError(userId, message) {
    await ensureGarminTables();
    await pool.query(
        `
        INSERT INTO user_integrations (user_id, provider, status, last_error, updated_at)
        VALUES ($1, 'garmin', 'error', $2, NOW())
        ON CONFLICT (user_id, provider)
        DO UPDATE SET status = 'error', last_error = EXCLUDED.last_error, updated_at = NOW()
        `,
        [userId, message]
    );
}

async function getGarminIntegration(userId) {
    await ensureGarminTables();
    const { rows } = await pool.query(
        `
        SELECT * FROM user_integrations
        WHERE user_id = $1 AND provider = 'garmin'
        `,
        [userId]
    );
    return rows[0] || null;
}

async function getValidGarminAccessToken(userId) {
    const integration = await getGarminIntegration(userId);
    if (!integration || integration.status !== 'connected') {
        throw new Error('Garmin is not connected');
    }
    if (!integration.access_token_encrypted || !integration.refresh_token_encrypted) {
        throw new Error('Garmin tokens missing');
    }
    const expiresAtMs = new Date(integration.token_expires_at).getTime();
    if (Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > 5 * 60 * 1000) {
        return decryptToken(integration.access_token_encrypted);
    }
    const refreshed = await refreshAccessToken(decryptToken(integration.refresh_token_encrypted));
    await saveGarminConnection(userId, {
        ...refreshed,
        provider_user_id: integration.provider_user_id,
    });
    return refreshed.access_token;
}

async function disconnectGarmin(userId) {
    await ensureGarminTables();
    await pool.query(
        `
        UPDATE user_integrations
        SET access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            token_expires_at = NULL,
            status = 'disconnected',
            disconnected_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE user_id = $1 AND provider = 'garmin'
        `,
        [userId]
    );
}

async function disconnectGarminByProviderUserId(providerUserId) {
    if (!providerUserId) return;
    await ensureGarminTables();
    await pool.query(
        `
        UPDATE user_integrations
        SET access_token_encrypted = NULL,
            refresh_token_encrypted = NULL,
            token_expires_at = NULL,
            status = 'disconnected',
            disconnected_at = NOW(),
            updated_at = NOW()
        WHERE provider = 'garmin' AND provider_user_id = $1
        `,
        [String(providerUserId)]
    );
}

module.exports = {
    ensureGarminTables,
    createGarminOAuthState,
    consumeGarminOAuthState,
    saveGarminConnection,
    markGarminError,
    getGarminIntegration,
    getValidGarminAccessToken,
    disconnectGarmin,
    disconnectGarminByProviderUserId,
};
