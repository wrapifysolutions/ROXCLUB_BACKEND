const crypto = require('node:crypto');
const pool = require('../pool');
const { queryWithHardTimeout } = require('../dbQuery');
const { ensureZeppTables } = require('./zeppTokens');
const {
    createZeppHealthSamplesTable,
    createZeppHealthSamplesIndex,
} = require('../../models/Zepp/ZeppDataSchema');

let dataTablesReady = false;

async function ensureZeppDataTables() {
    await ensureZeppTables();
    if (dataTablesReady) return;
    await queryWithHardTimeout(createZeppHealthSamplesTable, [], 8000);
    await queryWithHardTimeout(createZeppHealthSamplesIndex, [], 8000);
    dataTablesReady = true;
}

function firstNumber(...values) {
    for (const value of values) {
        if (value == null || value === '') continue;
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function toDate(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number') {
        const ms = value > 1e12 ? value : value * 1000;
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function flattenRecords(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (typeof payload !== 'object') return [];

    const nested = [payload.data, payload.records, payload.list, payload.items, payload.sports];
    for (const value of nested) {
        if (Array.isArray(value) && value.length > 0) {
            return value;
        }
    }

    return [payload];
}

function recordExternalId(sampleType, record, providerUserId) {
    const rawId =
        record.id ||
        record.trackId ||
        record.track_id ||
        record.sid ||
        record.eventId ||
        record.event_id ||
        record.uuid;

    if (rawId != null && String(rawId).trim()) {
        return `${sampleType}:${providerUserId || 'unknown'}:${String(rawId).trim()}`;
    }

    const start = toDate(
        record.startTime ||
            record.start_time ||
            record.timestamp ||
            record.date ||
            record.day
    );
    const stamp = start ? start.toISOString() : crypto.randomUUID();
    return `${sampleType}:${providerUserId || 'unknown'}:${stamp}`;
}

function normalizeRecord(sampleType, record, providerUserId) {
    const startAt = toDate(
        record.startTime ||
            record.start_time ||
            record.startAt ||
            record.timestamp ||
            record.date ||
            record.day ||
            record.time
    );
    const endAt = toDate(record.endTime || record.end_time || record.endAt);
    const duration = firstNumber(
        record.duration,
        record.duration_seconds,
        record.costTime,
        record.cost_time
    );

    return {
        sample_type: sampleType,
        provider_user_id: providerUserId,
        external_id: recordExternalId(sampleType, record, providerUserId),
        name: record.name || record.title || record.sportName || record.sport_name || null,
        sport_type:
            record.sportType ||
            record.sport_type ||
            record.type ||
            record.category ||
            sampleType,
        value: firstNumber(
            record.value,
            record.hrv,
            record.rmssd,
            record.steps,
            record.sleepScore,
            record.sleep_score
        ),
        unit: record.unit || null,
        start_at: startAt,
        end_at: endAt,
        duration_seconds: duration,
        distance: firstNumber(record.distance, record.dis, record.distance_meter),
        calories: firstNumber(record.calorie, record.calories, record.kcal),
        average_heartrate: firstNumber(
            record.average_heartrate,
            record.avgHeartRate,
            record.avg_hr,
            record.heartRate
        ),
        raw: record,
    };
}

async function upsertZeppSample(userId, sample) {
    if (!sample?.external_id) return false;

    await queryWithHardTimeout(
        `
        INSERT INTO zepp_health_samples (
            user_id, provider_user_id, sample_type, external_id, name, sport_type,
            value, unit, start_at, end_at, duration_seconds, distance, calories,
            average_heartrate, raw, updated_at
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, NOW()
        )
        ON CONFLICT (sample_type, external_id)
        DO UPDATE SET
            user_id = COALESCE(EXCLUDED.user_id, zepp_health_samples.user_id),
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, zepp_health_samples.provider_user_id),
            name = EXCLUDED.name,
            sport_type = EXCLUDED.sport_type,
            value = EXCLUDED.value,
            unit = EXCLUDED.unit,
            start_at = EXCLUDED.start_at,
            end_at = EXCLUDED.end_at,
            duration_seconds = EXCLUDED.duration_seconds,
            distance = EXCLUDED.distance,
            calories = EXCLUDED.calories,
            average_heartrate = EXCLUDED.average_heartrate,
            raw = EXCLUDED.raw,
            updated_at = NOW()
        `,
        [
            userId,
            sample.provider_user_id,
            sample.sample_type,
            sample.external_id,
            sample.name,
            sample.sport_type,
            sample.value,
            sample.unit,
            sample.start_at,
            sample.end_at,
            sample.duration_seconds,
            sample.distance,
            sample.calories,
            sample.average_heartrate,
            JSON.stringify(sample.raw || {}),
        ],
        8000
    );

    return true;
}

async function ingestZeppPayload(eventType, payload, userId, providerUserId) {
    await ensureZeppDataTables();

    const records = flattenRecords(payload);
    let saved = 0;
    const wellnessSamples = [];

    for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        const sample = normalizeRecord(eventType, record, providerUserId);
        if (await upsertZeppSample(userId, sample)) {
            saved += 1;
            wellnessSamples.push(sample);
        }
    }

    if (wellnessSamples.length > 0 && userId) {
        const { recordZeppSamples } = require('../readiness/dailyWellness');
        await recordZeppSamples(userId, wellnessSamples).catch((error) => {
            console.error('zepp wellness rollup failed', error.message);
        });
    }

    if (saved > 0 && userId) {
        const { enqueueReadinessRecompute } = require('../readiness/recomputeQueue');
        enqueueReadinessRecompute(userId);
    }

    return saved;
}

async function listZeppSamples(userId, { type, limit = 50, offset = 0 } = {}) {
    await ensureZeppDataTables();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const params = [userId, safeLimit, safeOffset];
    let typeFilter = '';
    if (type && ['activity', 'hrv', 'sleep'].includes(String(type))) {
        params.push(String(type));
        typeFilter = `AND sample_type = $4`;
    }

    const { rows } = await queryWithHardTimeout(
        `
        SELECT
            id, sample_type, name, sport_type, value, unit,
            start_at, end_at, duration_seconds, distance, calories,
            average_heartrate, updated_at
        FROM zepp_health_samples
        WHERE user_id = $1
          ${typeFilter}
        ORDER BY start_at DESC NULLS LAST, created_at DESC
        LIMIT $2 OFFSET $3
        `,
        params,
        8000
    );

    return rows;
}

async function countZeppSamples(userId) {
    await ensureZeppDataTables();
    const { rows } = await queryWithHardTimeout(
        `
        SELECT sample_type, COUNT(*)::int AS count
        FROM zepp_health_samples
        WHERE user_id = $1
        GROUP BY sample_type
        `,
        [userId],
        5000
    );

    return Object.fromEntries(rows.map((row) => [row.sample_type, row.count]));
}

module.exports = {
    ensureZeppDataTables,
    ingestZeppPayload,
    listZeppSamples,
    countZeppSamples,
};
