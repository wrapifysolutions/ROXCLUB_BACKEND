const { queryWithHardTimeout } = require('../dbQuery');
const { extractGarminUserId, ingestGarminPayload } = require('./garminDataStore');
const { disconnectGarminByProviderUserId } = require('./garminTokens');

async function resolveGarminUserId(providerUserId) {
    if (!providerUserId) return null;
    const { rows } = await queryWithHardTimeout(
        `
        SELECT user_id
        FROM user_integrations
        WHERE provider = 'garmin'
          AND provider_user_id = $1
          AND status = 'connected'
        LIMIT 1
        `,
        [providerUserId],
        5000
    );
    return rows[0]?.user_id || null;
}

async function handleGarminWebhook(eventType, payload) {
    const providerUserId = extractGarminUserId(payload);
    if (eventType === 'deregistrations') {
        const ids = Array.isArray(payload?.deregistrations)
            ? payload.deregistrations
            : providerUserId
              ? [{ userId: providerUserId }]
              : [];
        for (const row of ids) {
            await disconnectGarminByProviderUserId(row.userId || row.userID);
        }
        return { userId: null, providerUserId, samplesSaved: 0, deregistered: ids.length };
    }

    const userId = await resolveGarminUserId(providerUserId);
    const samplesSaved = await ingestGarminPayload(eventType, payload, userId, providerUserId);
    return { userId, providerUserId, samplesSaved, deregistered: 0 };
}

module.exports = { handleGarminWebhook, resolveGarminUserId };
