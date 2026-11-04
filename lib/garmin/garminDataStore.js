const { queryWithHardTimeout } = require('../dbQuery');
const { ensureGarminTables } = require('./garminTokens');
const {
    allowGarminWellnessSource,
    createGarminHealthSamplesTable,
    createGarminHealthSamplesIndex,
} = require('../../models/Garmin/GarminSchema');

let dataReady = false;

async function ensureGarminDataTables() {
    await ensureGarminTables();
    if (dataReady) return;
    await queryWithHardTimeout(allowGarminWellnessSource, [], 8000);
    await queryWithHardTimeout(createGarminHealthSamplesTable, [], 8000);
    await queryWithHardTimeout(createGarminHealthSamplesIndex, [], 8000);
    dataReady = true;
}

function firstNumber(...values) {
    for (const value of values) {
        if (value == null || value === '') continue;
        if (typeof value === 'object' && value.value != null) {
            const nested = Number(value.value);
            if (Number.isFinite(nested)) return nested;
            continue;
        }
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function fromUnixSeconds(value) {
    const seconds = firstNumber(value);
    if (seconds == null) return null;
    const ms = seconds > 1e12 ? seconds : seconds * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
}

function flattenGarmin(payload, keys) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    for (const key of keys) {
        if (Array.isArray(payload[key])) return payload[key];
    }
    return [];
}

function extractGarminUserId(payload) {
    const records = flattenGarmin(payload, [
        'activities',
        'activityDetails',
        'sleeps',
        'hrv',
        'dailies',
        'deregistrations',
    ]);
    const first = records[0] || payload;
    return first?.userId || first?.userID || payload?.userId || null;
}

function normalizeGarminRecord(sampleType, record, providerUserId) {
    const startAt =
        fromUnixSeconds(record.startTimeInSeconds) ||
        (record.calendarDate ? new Date(`${record.calendarDate}T00:00:00Z`) : null);
    const duration = firstNumber(record.durationInSeconds, record.duration);
    const endAt =
        startAt && duration != null ? new Date(startAt.getTime() + duration * 1000) : null;
    const externalId = String(
        record.summaryId ||
            record.activityId ||
            `${sampleType}:${providerUserId || 'unknown'}:${startAt ? startAt.toISOString() : 'none'}`
    );

    let value = null;
    let unit = null;
    if (sampleType === 'hrv') {
        value = firstNumber(record.lastNightAvg, record.hrv, record.value);
        unit = 'ms';
    } else if (sampleType === 'sleep') {
        value = firstNumber(record.durationInSeconds, record.overallSleepScore);
        unit = record.durationInSeconds != null ? 'seconds' : 'score';
    } else if (sampleType === 'steps') {
        value = firstNumber(record.steps);
        unit = 'count';
    } else if (sampleType === 'resting_hr') {
        value = firstNumber(record.restingHeartRateInBeatsPerMinute, record.restingHeartRate);
        unit = 'bpm';
    }

    return {
        sample_type: sampleType,
        provider_user_id: providerUserId,
        external_id: externalId,
        name: record.activityName || record.activityType || sampleType,
        sport_type: record.activityType || sampleType,
        value,
        unit,
        start_at: startAt,
        end_at: endAt,
        duration_seconds: duration,
        distance: firstNumber(record.distanceInMeters, record.distance),
        calories: firstNumber(record.activeKilocalories, record.calories),
        average_heartrate: firstNumber(record.averageHeartRateInBeatsPerMinute),
        raw: record,
    };
}

async function upsertGarminSample(userId, sample) {
    if (!sample?.external_id) return false;
    await queryWithHardTimeout(
        `
        INSERT INTO garmin_health_samples (
            user_id, provider_user_id, sample_type, external_id, name, sport_type,
            value, unit, start_at, end_at, duration_seconds, distance, calories,
            average_heartrate, raw, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb, NOW())
        ON CONFLICT (sample_type, external_id)
        DO UPDATE SET
            user_id = COALESCE(EXCLUDED.user_id, garmin_health_samples.user_id),
            provider_user_id = COALESCE(EXCLUDED.provider_user_id, garmin_health_samples.provider_user_id),
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

    if (userId && sample.sample_type === 'activity' && sample.start_at) {
        const { upsertCanonicalImportedActivity } = require('../athlete/canonicalActivity');
        await upsertCanonicalImportedActivity(
            userId,
            {
                source: 'GARMIN',
                externalId: sample.external_id,
                activityType: sample.sport_type,
                name: sample.name,
                startAt: sample.start_at,
                endAt: sample.end_at,
                durationSec: sample.duration_seconds,
                distanceM: sample.distance,
                avgHr: sample.average_heartrate,
            },
            (sql, params) => queryWithHardTimeout(sql, params, 8000)
        ).catch((error) => {
            console.error('canonical garmin activity failed', error.message);
        });
    }
    return true;
}

function recordsForEvent(eventType, payload) {
    if (eventType === 'activity') return flattenGarmin(payload, ['activities', 'activityDetails']);
    if (eventType === 'sleep') return flattenGarmin(payload, ['sleeps']);
    if (eventType === 'hrv') return flattenGarmin(payload, ['hrv']);
    if (eventType === 'dailies') return flattenGarmin(payload, ['dailies']);
    return [];
}

async function ingestGarminPayload(eventType, payload, userId, providerUserId) {
    await ensureGarminDataTables();
    const records = recordsForEvent(eventType, payload);
    let saved = 0;
    const wellness = [];

    for (const record of records) {
        if (!record || typeof record !== 'object') continue;
        if (eventType === 'dailies') {
            const steps = normalizeGarminRecord('steps', record, providerUserId);
            const resting = normalizeGarminRecord('resting_hr', record, providerUserId);
            if (steps.value != null && (await upsertGarminSample(userId, steps))) {
                saved += 1;
                wellness.push(steps);
            }
            if (resting.value != null && (await upsertGarminSample(userId, resting))) {
                saved += 1;
                wellness.push(resting);
            }
            continue;
        }
        const sample = normalizeGarminRecord(eventType, record, providerUserId);
        if (await upsertGarminSample(userId, sample)) {
            saved += 1;
            wellness.push(sample);
        }
    }

    if (userId && wellness.length) {
        const { recordGarminSamples } = require('../readiness/dailyWellness');
        await recordGarminSamples(userId, wellness).catch((error) => {
            console.error('garmin wellness rollup failed', error.message);
        });
        await queryWithHardTimeout(
            `
            UPDATE user_integrations
            SET last_synced_at = NOW(), last_sync_status = 'success', last_error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND provider = 'garmin'
            `,
            [userId],
            5000
        ).catch(() => {});
        const { enqueueReadinessRecompute } = require('../readiness/recomputeQueue');
        enqueueReadinessRecompute(userId);
    }

    return saved;
}

async function countGarminSamples(userId) {
    await ensureGarminDataTables();
    const { rows } = await queryWithHardTimeout(
        `
        SELECT sample_type, COUNT(*)::int AS count
        FROM garmin_health_samples
        WHERE user_id = $1
        GROUP BY sample_type
        `,
        [userId],
        8000
    );
    return Object.fromEntries(rows.map((row) => [row.sample_type, row.count]));
}

module.exports = {
    ensureGarminDataTables,
    extractGarminUserId,
    normalizeGarminRecord,
    flattenGarmin,
    ingestGarminPayload,
    countGarminSamples,
};
