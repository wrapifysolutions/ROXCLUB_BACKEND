const { query: dbQuery } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { enqueueReadinessRecompute } = require('../readiness/recomputeQueue');

const FLAGS = new Set(['soreness', 'pain', 'low_energy', 'poor_sleep']);

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

async function submitDebrief(userId, activityId, body, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || dbQuery;
    const rpe = Number(body?.rpe);
    if (!Number.isInteger(rpe) || rpe < 1 || rpe > 10) {
        throw httpError('INVALID_DEBRIEF', 400, 'rpe must be an integer from 1 to 10');
    }
    const flags = Array.isArray(body?.flags) ? body.flags : [];
    if (flags.some((flag) => !FLAGS.has(flag))) {
        throw httpError('INVALID_DEBRIEF', 400, 'flags must be soreness, pain, low_energy, or poor_sleep');
    }
    const notes = body?.notes == null ? null : String(body.notes).slice(0, 2000);

    const { rows } = await query(
        `
        /* workout:load_activity_owner */
        SELECT id, user_id FROM activities WHERE id = $1
        `,
        [activityId]
    );
    const activity = rows[0];
    if (!activity) throw httpError('ACTIVITY_NOT_FOUND', 404, 'Activity not found');
    if (String(activity.user_id) !== String(userId)) {
        throw httpError('FORBIDDEN', 403, 'Activity belongs to another user');
    }

    const saved = await query(
        `
        /* workout:upsert_debrief */
        INSERT INTO activity_debriefs (activity_id, user_id, rpe, flags, notes)
        VALUES ($1, $2, $3, $4::text[], $5)
        ON CONFLICT (activity_id) DO UPDATE SET
            rpe = EXCLUDED.rpe,
            flags = EXCLUDED.flags,
            notes = EXCLUDED.notes,
            created_at = NOW()
        RETURNING activity_id, rpe, flags, notes, created_at
        `,
        [activityId, userId, rpe, flags, notes]
    );
    const enqueue = options.enqueueReadinessRecompute || enqueueReadinessRecompute;
    enqueue(userId);
    const row = saved.rows[0];
    return {
        activityId: row.activity_id,
        rpe: Number(row.rpe),
        flags: row.flags || [],
        notes: row.notes,
    };
}

module.exports = { submitDebrief };
