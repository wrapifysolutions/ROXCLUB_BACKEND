const homeConfig = require('../../config/home.json');
const { presentAthleteDna } = require('../athlete/dnaPresenter');
const { levelFromXp, workoutById, recoveryScoreThreshold } = require('../onboarding/programCatalog');

const CALIBRATING_MESSAGE = 'CALIBRATING – Log 3 sessions or a 5-sec check-in';

function newAthleteLimit() {
    const configured = Number(homeConfig.newAthleteSessions);
    return Number.isFinite(configured) && configured > 0 ? configured : 3;
}

function readinessScore(input) {
    if (input.dailyReadiness && input.dailyReadiness.score != null) return Number(input.dailyReadiness.score);
    if (input.checkInScore != null) return Number(input.checkInScore);
    return null;
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
        speed: row.speed ?? null,
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
        hrv: watch.hrv?.available ? watch.hrv.value : watch.hrv ?? null,
        sleep: watch.sleep?.available ? watch.sleep.value : watch.sleep ?? null,
        resting_hr: watch.resting_hr?.available ? watch.resting_hr.value : watch.resting_hr ?? null,
        average_heartrate: watch.strava_hr?.available ? watch.strava_hr.value : watch.average_heartrate ?? null,
        thisWeek: watch.thisWeek || watch.this_week || null,
        source:
            watch.hrv?.source ||
            watch.sleep?.source ||
            watch.resting_hr?.source ||
            watch.strava_hr?.source ||
            watch.source ||
            null,
    };
    if (typeof attributes.hrv === 'object') attributes.hrv = attributes.hrv?.value ?? null;
    if (typeof attributes.sleep === 'object') attributes.sleep = attributes.sleep?.value ?? null;
    if (typeof attributes.resting_hr === 'object') attributes.resting_hr = attributes.resting_hr?.value ?? null;
    const metrics = {
        hrv: attributes.hrv,
        sleep: attributes.sleep,
        resting_hr: attributes.resting_hr,
        average_heartrate: attributes.average_heartrate,
    };
    const anyValue = Object.values(metrics).some((value) => value != null);
    if (!anyValue && !attributes.thisWeek) return null;
    return {
        ...metrics,
        thisWeek: attributes.thisWeek,
        source: attributes.source,
    };
}

function buildHomeResponse(input) {
    const state = resolveHomeState(input);
    const avatar = asAvatar(input.avatar);
    const score = readinessScore(input);
    const recoveryNeeded = recoveryNeededFrom(input, score);
    const watch = watchAttributes(input.watch);
    const liveAttributes = dnaAttributes(input.dna);
    const readiness = input.dailyReadiness
        ? {
              status: input.dailyReadiness.status,
              score,
              confidence: input.dailyReadiness.confidence || null,
              source: 'daily_readiness',
              ...(input.dailyReadiness.status === 'CALIBRATING' ? { message: CALIBRATING_MESSAGE } : {}),
          }
        : score == null
          ? { status: 'CALIBRATING', score: null, source: null, message: CALIBRATING_MESSAGE }
          : {
                status: recoveryNeeded ? 'RECOVERY_NEEDED' : 'READY',
                score,
                source: 'checkin',
            };

    const body = {
        state,
        user: {
            name: input.name,
            gender: input.gender || null,
            avatar,
        },
        readiness,
        recoveryNeeded,
        todayWorkout: todayWorkoutFrom(input.todaySession),
        watch,
        dna: {
            status: input.dnaStatus || 'CALIBRATING',
            attributes: liveAttributes,
        },
        adaptation: input.adaptation || null,
        athleteDna: presentAthleteDna({
            status: input.dnaStatus,
            model_version: input.dnaModelVersion || input.dna?.model_version || 'v0',
            endurance: input.dna?.endurance,
            engine: input.dna?.engine,
            strength: input.dna?.strength,
            power: input.dna?.power,
            speed: input.dna?.speed,
            mobility: input.dna?.mobility,
            peak_endurance: input.dna?.peak_endurance,
            peak_engine: input.dna?.peak_engine,
            peak_strength: input.dna?.peak_strength,
            peak_power: input.dna?.peak_power,
            peak_speed: input.dna?.peak_speed,
            peak_mobility: input.dna?.peak_mobility,
        }),
        level: levelFromXp(input.xpTotal),
        seasonal: input.seasonal || { key: null, points: 0, resets: true, affectsLevel: false },
        featuredCategories: input.featuredCategories || [],
        recentActivities: input.recentActivities || [],
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
