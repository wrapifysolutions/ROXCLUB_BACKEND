const pool = require('../pool');
const { queryWithHardTimeout } = require('../dbQuery');
const { ensureZeppTables } = require('./zeppTokens');
const { ingestZeppPayload } = require('./zeppDataStore');
const {
    createZeppWebhookEventsTable,
    createZeppWebhookEventsIndex,
} = require('../../models/Zepp/ZeppWebhookSchema');

let webhookTablesReady = false;

async function ensureZeppWebhookTables() {
    if (webhookTablesReady) return;
    await ensureZeppTables();
    await queryWithHardTimeout(createZeppWebhookEventsTable, [], 8000);
    await queryWithHardTimeout(createZeppWebhookEventsIndex, [], 8000);
    webhookTablesReady = true;
}

function extractProviderUserId(payload) {
    if (!payload || typeof payload !== 'object') return null;

    const candidates = [
        payload.openId,
        payload.open_id,
        payload.userId,
        payload.user_id,
        payload.uid,
        payload.provider_user_id,
        payload.userOpenId,
    ];

    for (const value of candidates) {
        if (value != null && String(value).trim()) {
            return String(value).trim();
        }
    }

    if (Array.isArray(payload) && payload[0]) {
        return extractProviderUserId(payload[0]);
    }

    return null;
}

async function resolveRoxClubUserId(providerUserId) {
    if (!providerUserId) return null;

    const { rows } = await queryWithHardTimeout(
        `
        SELECT user_id
        FROM user_integrations
        WHERE provider = 'zepp'
          AND provider_user_id = $1
          AND status = 'connected'
        LIMIT 1
        `,
        [providerUserId],
        5000
    );

    return rows[0]?.user_id || null;
}

async function saveZeppWebhookEvent(eventType, payload) {
    await ensureZeppWebhookTables();

    const providerUserId = extractProviderUserId(payload);
    const userId = await resolveRoxClubUserId(providerUserId);

    const { rows } = await queryWithHardTimeout(
        `
        INSERT INTO zepp_webhook_events (
            event_type,
            user_id,
            provider_user_id,
            payload,
            received_at
        )
        VALUES ($1, $2, $3, $4::jsonb, NOW())
        RETURNING id, event_type, user_id, provider_user_id, received_at
        `,
        [eventType, userId, providerUserId, JSON.stringify(payload ?? {})],
        8000
    );

    let samplesSaved = 0;
    try {
        samplesSaved = await ingestZeppPayload(eventType, payload, userId, providerUserId);
    } catch (error) {
        console.warn('Zepp sample ingest warning:', error.message);
    }

    if (userId) {
        await queryWithHardTimeout(
            `
            UPDATE user_integrations
            SET
                last_synced_at = NOW(),
                last_sync_status = 'success',
                last_error = NULL,
                updated_at = NOW()
            WHERE user_id = $1 AND provider = 'zepp'
            `,
            [userId],
            5000
        ).catch(() => {});
    }

    return { ...rows[0], samples_saved: samplesSaved };
}

module.exports = {
    ensureZeppWebhookTables,
    saveZeppWebhookEvent,
};
