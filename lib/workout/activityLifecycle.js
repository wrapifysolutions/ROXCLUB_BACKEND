const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { buildXp } = require('./xpService');
const { reverseActivityXp, replaceActivityXp } = require('./xpLedger');

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function materialChange(current, next) {
    const fields = ['durationSec', 'distanceM', 'avgHr', 'completedCount'];
    return fields.some((field) => {
        const left = finite(current[field]);
        const right = finite(next[field]);
        if (right == null) return false;
        return left !== right;
    });
}

async function loadOwnedActivity(userId, activityId, query) {
    const { rows } = await query(
        `
        /* workout:load_activity */
        SELECT id, user_id, source, activity_type, name, duration_sec, distance_m, avg_hr,
               evidence_status, start_at, session_id
        FROM activities
        WHERE id = $1 AND user_id = $2
        `,
        [activityId, userId]
    );
    if (!rows[0]) throw httpError('ACTIVITY_NOT_FOUND', 404, 'Activity not found');
    return rows[0];
}

async function invalidateActivity(userId, activityId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || queryWithHardTimeout;
    const activity = await loadOwnedActivity(userId, activityId, query);
    if (String(activity.evidence_status || '').toUpperCase() === 'INVALIDATED') {
        return { activityId, status: 'INVALIDATED', reversed: [] };
    }
    const reversed = await reverseActivityXp(userId, activityId, query, { at: activity.start_at });
    await query(
        `
        /* workout:invalidate_activity */
        UPDATE activities
        SET evidence_status = 'INVALIDATED', updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        `,
        [activityId, userId]
    );
    return { activityId, status: 'INVALIDATED', reversed };
}

async function finishedWorkFor(activity, query) {
    try {
        const { rows } = await query(
            `
            /* workout:activity_work */
            SELECT name, kind
            FROM activity_splits
            WHERE activity_id = $1 AND kind <> 'roxzone'
            ORDER BY activity_index
            `,
            [activity.id]
        );
        if (rows.length) return rows;
    } catch (error) {
        if (error.code !== '42P01' && error.code !== '42703') throw error;
    }
    return [{ name: activity.activity_type || activity.name || 'workout' }];
}

async function editActivity(userId, activityId, body = {}, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || queryWithHardTimeout;
    const activity = await loadOwnedActivity(userId, activityId, query);
    if (String(activity.evidence_status || '').toUpperCase() === 'INVALIDATED') {
        throw httpError('ACTIVITY_INVALIDATED', 409, 'Invalidated activity cannot be edited');
    }

    const next = {
        durationSec: body.durationSec ?? body.duration_sec ?? activity.duration_sec,
        distanceM: body.distanceM ?? body.distance_m ?? activity.distance_m,
        avgHr: body.avgHr ?? body.avg_hr ?? activity.avg_hr,
        completedCount: body.completedCount ?? null,
    };
    const current = {
        durationSec: activity.duration_sec,
        distanceM: activity.distance_m,
        avgHr: activity.avg_hr,
        completedCount: null,
    };

    await query(
        `
        /* workout:edit_activity */
        UPDATE activities
        SET duration_sec = $3,
            distance_m = $4,
            avg_hr = $5,
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        `,
        [activityId, userId, next.durationSec, next.distanceM, next.avgHr]
    );

    if (!materialChange(current, next)) {
        return { activityId, recalculated: false, totalXp: null };
    }

    const work = await finishedWorkFor(activity, query);
    const finishedWork =
        next.completedCount != null ? work.slice(0, Math.max(0, Number(next.completedCount) || 0)) : work;
    const rows = buildXp({
        workoutType: activity.activity_type,
        partial: false,
        finishedWork,
        priorSessionsToday: 0,
        durationSec: next.durationSec,
        averageHr: next.avgHr,
    });
    const awarded = await replaceActivityXp(userId, activityId, rows, query, { at: activity.start_at });
    return {
        activityId,
        recalculated: true,
        totalXp: awarded.reduce((sum, row) => sum + row.xp, 0),
        xpBreakdown: awarded,
    };
}

module.exports = { invalidateActivity, editActivity, materialChange };
