const { levelFromXp, workoutById, recoveryScoreThreshold } = require('../onboarding/programCatalog');

const CALIBRATING_MESSAGE = 'CALIBRATING – Log 3 sessions or a 5-sec check-in';

function watchReadinessScore(watch) {
    if (!watch?.ready?.available || watch.ready.score == null) return null;
    return Number(watch.ready.score);
}

function dailyScore(dailyReadiness) {
    if (!dailyReadiness || dailyReadiness.score == null) return null;
    return Number(dailyReadiness.score);
}

function resolveHomeState({ completedSessions, checkInScore, watch, threshold, dailyReadiness }) {
    const completed = Number(completedSessions) || 0;
    const score =
        dailyReadiness != null
            ? dailyScore(dailyReadiness)
            : checkInScore != null
              ? Number(checkInScore)
              : watchReadinessScore(watch);
    const limit = threshold == null ? recoveryScoreThreshold() : threshold;
    if (dailyReadiness?.status === 'RECOVERY_NEEDED' || (score != null && score < limit)) {
        return 'RECOVERY_NEEDED';
    }
    if (completed < 3 && score == null) return 'NEW_ATHLETE';
    return 'NORMAL';
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
    const watchScore = watchReadinessScore(input.watch);
    const score = input.dailyReadiness
        ? dailyScore(input.dailyReadiness)
        : input.checkInScore != null
          ? Number(input.checkInScore)
          : watchScore;
    const liveAttributes = watchAttributes(input.watch) || dnaAttributes(input.dna);
    const readiness = input.dailyReadiness
        ? {
              status: input.dailyReadiness.status,
              score,
              confidence: input.dailyReadiness.confidence || null,
              source: 'daily_readiness',
              ...(input.dailyReadiness.status === 'CALIBRATING' ? { message: CALIBRATING_MESSAGE } : {}),
          }
        : state === 'NEW_ATHLETE'
          ? { status: 'CALIBRATING', score: null, source: readinessSource(input.watch), message: CALIBRATING_MESSAGE }
          : state === 'RECOVERY_NEEDED'
            ? { status: 'RECOVERY_NEEDED', score, source: readinessSource(input.watch) }
            : {
                  status: input.watch?.ready?.status || 'READY',
                  score,
                  source: readinessSource(input.watch),
              };

    const body = {
        state,
        user: {
            name: input.name,
            avatar,
        },
        readiness,
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
