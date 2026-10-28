const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { resolveUserTimezone } = require('../readiness/userTimezone');
const { ensureTodayReadiness } = require('../readiness/readinessService');
const { listCategories, listWorkouts, getCategoryName } = require('./workoutCatalog');
const { toWorkoutListItem } = require('./workoutDto');

const DONE = new Set(['done', 'partial', 'replaced']);

const READINESS_HINTS = {
    PRIMED: 'You are primed — push hard today',
    READY: 'You are ready to train',
    MODERATE: 'Keep today moderate',
    FATIGUED: 'Dial it back today',
    RECOVERY_NEEDED: 'Prioritize recovery today',
};

function readinessHint(daily) {
    if (!daily || daily.status === 'CALIBRATING' || daily.score == null) return null;
    return READINESS_HINTS[daily.status] || null;
}

async function loadTodayScheduled(userId, today, query) {
    const { rows } = await query(
        `
        /* train:today_session */
        SELECT id, workout_id, title, duration_min, status, completed_at
        FROM scheduled_sessions
        WHERE user_id = $1 AND scheduled_on = $2::date
        LIMIT 1
        `,
        [userId, today]
    );
    return rows[0] || null;
}

function continueFrom(session) {
    if (!session) return null;
    const status = String(session.status || '').toLowerCase();
    if (DONE.has(status) || session.completed_at) return null;
    const durationMin = Number(session.duration_min) || 0;
    return {
        scheduledSessionId: session.id,
        workoutId: session.workout_id,
        title: session.title,
        durationMin,
        statusText: `Not started today · ${durationMin} min`,
    };
}

async function getTrainOverview(userId, options = {}) {
    if (!options.query) await ensureOnboardingProfileSchema();
    const query = options.query || queryWithHardTimeout;
    const zone = await resolveUserTimezone(userId, options.timezone, query);
    const today = options.today || isoDate(zone);

    let daily = null;
    try {
        const readiness = await ensureTodayReadiness(userId, today, query);
        daily = readiness?.today || null;
    } catch (_) {
        daily = null;
    }

    const scheduled = await loadTodayScheduled(userId, today, query);
    const featuredPage = listWorkouts({ limit: 3 });

    return {
        readinessHint: readinessHint(daily),
        continue: continueFrom(scheduled),
        categories: listCategories(),
        featuredWorkouts: featuredPage.workouts.map((workout) =>
            toWorkoutListItem(workout, getCategoryName(workout.categoryId))
        ),
    };
}

module.exports = {
    getTrainOverview,
    readinessHint,
    continueFrom,
};
