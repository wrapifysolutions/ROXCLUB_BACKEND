const homeConfig = require('../../config/home.json');
const { levelFromXp, workoutById, recoveryScoreThreshold } = require('../onboarding/programCatalog');

const CALIBRATING_MESSAGE = 'CALIBRATING – Log 3 sessions or a 5-sec check-in';

function watchReadinessScore(watch) {
    if (!watch?.ready?.available || watch.ready.score == null) return null;
    return Number(watch.ready.score);
}

function newAthleteLimit() {
    const configured = Number(homeConfig.newAthleteSessions);
    return Number.isFinite(configured) && configured > 0 ? configured : 3;
}

function readinessScore(input) {
    if (input.dailyReadiness && input.dailyReadiness.score != null) return Number(input.dailyReadiness.score);
    if (input.checkInScore != null) return Number(input.checkInScore);
    return watchReadinessScore(input.watch);
}

function resolveHomeState({ completedSessions }) {
    const completed = Number(completedSessions) || 0;
    if (completed < newAthleteLimit()) return 'NEW_ATHLETE';
    return 'NORMAL';
}

function recoveryNeededFrom(input, score) {
    if (input.dailyReadiness?.status === 'RECOVERY_NEEDED') return true;
    const limit = input.threshold == null ? recoveryScoreThreshold() : input.threshold;
    return score != null && score < limit;
}

function asAvatar(value) {
    if (!value) return null;
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (_) {
            return null;
        }
    }
    return value;
}

function dnaAttributes(row) {
    if (!row) return null;
    if (row.attributes) return row.attributes;
    const values = {
        strength: row.strength ?? null,
        engine: row.engine ?? null,
        endurance: row.endurance ?? null,
        power: row.power ?? null,
        mobility: row.mobility ?? null,
    };
    const anyValue = Object.values(values).some((value) => value != null);
    return anyValue ? values : null;
}

function todayWorkoutFrom(session) {
    if (!session) return null;
    const workout = session.workout || workoutById(session.workout_id);
    return {
        id: session.workout_id,
        title: workout?.title || session.title,
        durationMin: Number(workout?.durationMin ?? session.duration_min),
        scheduledOn: session.scheduled_on,
        week: session.week_number,
        day: Number(session.plan_day),
        status: session.status || (session.completed_at ? 'done' : 'pending'),
        workout: workout || null,
    };
}

function watchAttributes(watch) {
    if (!watch) return null;
    const attributes = {
        hrv: watch.hrv?.available ? watch.hrv.value : null,
        sleep: watch.sleep?.available ? watch.sleep.value : null,
        resting_hr: watch.resting_hr?.available ? watch.resting_hr.value : null,
        average_heartrate: watch.strava_hr?.available ? watch.strava_hr.value : null,
    };
    const anyValue = Object.values(attributes).some((value) => value != null);
    return anyValue ? attributes : null;
}

function readinessSource(watch) {
    return (
        watch?.hrv?.source ||
        watch?.sleep?.source ||
        watch?.resting_hr?.source ||
        watch?.strava_hr?.source ||
        null
    );
}

function buildHomeResponse(input) {
    const state = resolveHomeState(input);
    const avatar = asAvatar(input.avatar);
    const score = readinessScore(input);
    const recoveryNeeded = recoveryNeededFrom(input, score);
    const liveAttributes = watchAttributes(input.watch) || dnaAttributes(input.dna);
    const readiness = input.dailyReadiness
        ? {
              status: input.dailyReadiness.status,
              score,
              confidence: input.dailyReadiness.confidence || null,
              source: 'daily_readiness',
              ...(input.dailyReadiness.status === 'CALIBRATING' ? { message: CALIBRATING_MESSAGE } : {}),
          }
        : score == null
          ? { status: 'CALIBRATING', score: null, source: readinessSource(input.watch), message: CALIBRATING_MESSAGE }
          : {
                status: recoveryNeeded ? 'RECOVERY_NEEDED' : input.watch?.ready?.status || 'READY',
                score,
                source: input.checkInScore != null && watchReadinessScore(input.watch) == null ? 'checkin' : readinessSource(input.watch),
            };

    const body = {
        state,
        user: {
            name: input.name,
            avatar,
        },
        readiness,
        recoveryNeeded,
        todayWorkout: todayWorkoutFrom(input.todaySession),
        dna: {
            status: liveAttributes ? 'READY' : input.dnaStatus || 'CALIBRATING',
            attributes: liveAttributes,
        },
        level: levelFromXp(input.xpTotal),
        featuredCategories: input.featuredCategories || [],
    };

    if (state !== 'NORMAL') return body;

    return {
        ...body,
        thisWeek: input.thisWeek || { sessions: [] },
        categories: input.categories || [],
        nextGoal: input.nextGoal || null,
        virtualAthlete: avatar,
        sync: input.sync || { providers: [] },
        unreadNotifications: Number(input.unreadNotifications) || 0,
    };
}

module.exports = {
    resolveHomeState,
    buildHomeResponse,
    dnaAttributes,
    watchAttributes,
    todayWorkoutFrom,
};
