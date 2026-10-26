const pool = require('../pool');
const {
    createUserIntegrationsTable,
} = require('../../models/StarvaModel/StarvaSchama');
const {
    createAppleHealthSamplesTableOnly,
    createAppleHealthSamplesIndex,
} = require('../../models/AppleHealth/AppleHealthSchema');

let tablesReady = false;

async function ensureAppleHealthTables() {
    if (tablesReady) {
        return;
    }

    await pool.query(createUserIntegrationsTable);
    await pool.query(createAppleHealthSamplesTableOnly);
    await pool.query(createAppleHealthSamplesIndex);
    tablesReady = true;
}

async function connectAppleHealth(userId, { deviceId, permissions } = {}) {
    await ensureAppleHealthTables();

    const providerUserId = deviceId ? String(deviceId) : null;
    const metadataNote = Array.isArray(permissions)
        ? permissions.join(',')
        : null;

    const { rows } = await pool.query(
        `
        INSERT INTO user_integrations (
            user_id,
            provider,
            provider_user_id,
            status,
            connected_at,
            disconnected_at,
            last_error,
            last_sync_status,
            updated_at
        )
        VALUES ($1, 'apple_health', $2, 'connected', NOW(), NULL, $3, 'pending', NOW())
        ON CONFLICT (user_id, provider)
        DO UPDATE SET
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, user_integrations.provider_user_id),
            status = 'connected',
            connected_at = NOW(),
            disconnected_at = NULL,
            last_error = NULL,
            updated_at = NOW()
        RETURNING id, user_id, provider, provider_user_id, status, connected_at, last_synced_at
        `,
        [userId, providerUserId, metadataNote]
    );

    return rows[0];
}

async function getAppleHealthIntegration(userId) {
    await ensureAppleHealthTables();
    const { rows } = await pool.query(
        `
        SELECT *
        FROM user_integrations
        WHERE user_id = $1 AND provider = 'apple_health'
        `,
        [userId]
    );
    return rows[0] || null;
}

async function disconnectAppleHealth(userId) {
    await ensureAppleHealthTables();
    await pool.query(
        `
        UPDATE user_integrations
        SET
            status = 'disconnected',
            disconnected_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE user_id = $1 AND provider = 'apple_health'
        `,
        [userId]
    );
}

async function upsertAppleHealthSamples(userId, samples = []) {
    await ensureAppleHealthTables();

    let saved = 0;

    for (const sample of samples) {
        const sampleType = String(sample.sample_type || sample.type || '')
            .trim()
            .toLowerCase();
        const startAt = sample.start_at || sample.startDate;
        if (!sampleType || !startAt) {
            continue;
        }

        const externalId =
            sample.external_id ||
            sample.uuid ||
            `${sampleType}:${new Date(startAt).toISOString()}:${sample.value ?? ''}`;

        await pool.query(
            `
            INSERT INTO apple_health_samples (
                user_id,
                sample_type,
                value,
                unit,
                start_at,
                end_at,
                source_name,
                external_id,
                metadata,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
            ON CONFLICT (user_id, sample_type, external_id)
            DO UPDATE SET
                value = EXCLUDED.value,
                unit = EXCLUDED.unit,
                start_at = EXCLUDED.start_at,
                end_at = EXCLUDED.end_at,
                source_name = EXCLUDED.source_name,
                metadata = EXCLUDED.metadata,
                updated_at = NOW()
            `,
            [
                userId,
                sampleType,
                sample.value ?? null,
                sample.unit || null,
                startAt,
                sample.end_at || sample.endDate || null,
                sample.source_name || sample.sourceName || null,
                String(externalId),
                JSON.stringify(sample.metadata || {}),
            ]
        );
        saved += 1;
    }

    if (saved > 0) {
        const { recordAppleSamples } = require('../readiness/dailyWellness');
        await recordAppleSamples(userId, samples).catch((error) => {
            console.error('apple wellness rollup failed', error.message);
        });
    }

    await pool.query(
        `
        UPDATE user_integrations
        SET
            last_synced_at = NOW(),
            last_sync_status = 'success',
            last_error = NULL,
            updated_at = NOW()
        WHERE user_id = $1 AND provider = 'apple_health'
        `,
        [userId]
    );

    const { enqueueReadinessRecompute } = require('../readiness/recomputeQueue');
    enqueueReadinessRecompute(userId);

    return saved;
}

async function listAppleHealthSamples(userId, { type, limit = 50, offset = 0 } = {}) {
    await ensureAppleHealthTables();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const params = [userId, safeLimit, safeOffset];
    let typeFilter = '';
    if (type) {
        params.push(String(type).toLowerCase());
        typeFilter = 'AND sample_type = $4';
    }

    const { rows } = await pool.query(
        `
        SELECT
            id, sample_type, value, unit, start_at, end_at,
            source_name, external_id, metadata, updated_at
        FROM apple_health_samples
        WHERE user_id = $1
          ${typeFilter}
        ORDER BY start_at DESC
        LIMIT $2 OFFSET $3
        `,
        params
    );

    return rows;
}

async function summarizeAppleHealth(userId) {
    await ensureAppleHealthTables();
    const { rows } = await pool.query(
        `
        SELECT
            sample_type,
            COUNT(*)::int AS count,
            MAX(start_at) AS last_at,
            SUM(value) AS total_value
        FROM apple_health_samples
        WHERE user_id = $1
        GROUP BY sample_type
        `,
        [userId]
    );

    return Object.fromEntries(
        rows.map((row) => [
            row.sample_type,
            {
                count: row.count,
                lastAt: row.last_at,
                totalValue: row.total_value,
            },
        ])
    );
}

module.exports = {
    ensureAppleHealthTables,
    connectAppleHealth,
    getAppleHealthIntegration,
    disconnectAppleHealth,
    upsertAppleHealthSamples,
    listAppleHealthSamples,
    summarizeAppleHealth,
};
