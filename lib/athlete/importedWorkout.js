const { upsertCanonicalImportedActivity } = require('./canonicalActivity');
const { awardImportedActivityXp } = require('./importXp');
const { collapseAssociated, loadAssociatedLinks } = require('./identityLinks');

function metadataObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function durationFromSample(sample, meta) {
    const direct = finite(sample.duration_seconds ?? meta.duration_seconds);
    if (direct != null && direct > 0) return direct;
    const start = sample.start_at || sample.startDate;
    const end = sample.end_at || sample.endDate;
    if (!start || !end) return null;
    const minutes = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
}

function importedPayloadFromHealthSample(sample, source) {
    const type = String(sample.sample_type || sample.type || '')
        .trim()
        .toLowerCase();
    if (type !== 'workout' && type !== 'activity') return null;
    const meta = metadataObject(sample.metadata);
    const startAt = sample.start_at || sample.startDate;
    if (!startAt) return null;
    const externalId =
        sample.external_id ||
        sample.uuid ||
        `${type}:${new Date(startAt).toISOString()}:${sample.value ?? ''}`;
    return {
        source,
        externalId: String(externalId),
        activityType: meta.sport_type || meta.activity_type || sample.sport_type || type,
        name: meta.name || sample.name || null,
        startAt,
        endAt: sample.end_at || sample.endDate || null,
        durationSec: durationFromSample(sample, meta),
        distanceM: finite(sample.distance ?? meta.distance ?? sample.value),
        avgHr: finite(sample.average_heartrate ?? meta.average_heartrate),
    };
}

async function recordImportedWorkout(userId, payload, query) {
    const activityId = await upsertCanonicalImportedActivity(userId, payload, query);
    if (!activityId) return null;
    await awardImportedActivityXp(userId, activityId, payload, query).catch((error) => {
        if (error.code === 'DATABASE_NOT_READY' || error.code === '42P01' || error.code === '42703') {
            return [];
        }
        console.error('import xp failed', error.message);
        return [];
    });
    const { fanoutImportedNotification } = require('../notifications/events');
    fanoutImportedNotification(userId, payload, activityId);
    return activityId;
}

function sourceKey(source) {
    return String(source || '').trim().toUpperCase().replace(/-/g, '_');
}

async function collapseImportedFeed(userId, workouts, query) {
    if (!userId || !workouts?.length) return workouts || [];
    let links = [];
    let activities = [];
    try {
        links = await loadAssociatedLinks(userId, query);
        const result = await query(
            `
            /* engine:feed_activity_index */
            SELECT id, source, external_id
            FROM activities
            WHERE user_id = $1 AND external_id IS NOT NULL
            `,
            [userId]
        );
        activities = result.rows || [];
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703' || error.code === 'DATABASE_NOT_READY') {
            return workouts;
        }
        throw error;
    }

    const byExternal = new Map(
        activities.map((row) => [`${sourceKey(row.source)}:${row.external_id}`, row.id])
    );
    const withIds = workouts.map((workout) => ({
        ...workout,
        id:
            byExternal.get(`${sourceKey(workout.source)}:${workout.external_id}`) ||
            workout.external_id,
    }));
    return collapseAssociated(withIds, links).map((row) => {
        const { id, ...rest } = row;
        return rest;
    });
}

module.exports = {
    importedPayloadFromHealthSample,
    recordImportedWorkout,
    collapseImportedFeed,
};
