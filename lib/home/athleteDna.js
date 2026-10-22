const { queryWithHardTimeout } = require('../dbQuery');
const { ensureAppleHealthTables } = require('../appleHealth/appleHealthStore');
const { ensureZeppDataTables } = require('../zepp/zeppDataStore');
const { ensureStravaDataTables } = require('../strava/stravaSync');

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function startOfWeekUtc(now = new Date()) {
    const date = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    return date;
}

function pickLatest(appleRow, zeppRow) {
    const appleAt = appleRow?.start_at ? new Date(appleRow.start_at).getTime() : 0;
    const zeppAt = zeppRow?.start_at ? new Date(zeppRow.start_at).getTime() : 0;
    if (!appleRow && !zeppRow) return null;
    if (!appleRow) return zeppRow;
    if (!zeppRow) return appleRow;
    return zeppAt > appleAt ? zeppRow : appleRow;
}

function sleepScoreFromValue(value) {
    if (value == null) return null;
    if (value <= 24) return clamp(Math.round((value / 8) * 100), 0, 100);
    if (value <= 1440) return clamp(Math.round((value / 60 / 8) * 100), 0, 100);
    return clamp(Math.round(value), 0, 100);
}

function hrvScoreFromValue(latest, baseline) {
    if (latest == null) return null;
    if (baseline && baseline > 0) {
        return clamp(Math.round(75 + ((latest - baseline) / baseline) * 100), 0, 100);
    }
    return clamp(Math.round(25 + ((latest - 20) / 50) * 65), 0, 100);
}

function restingHrScore(value) {
    if (value == null) return null;
    return clamp(Math.round(130 - value), 0, 100);
}

function readyStatus(score) {
    if (score == null) return null;
    if (score >= 80) return 'peak';
    if (score >= 60) return 'ready';
    if (score >= 40) return 'moderate';
    return 'rest';
}

function computeReady({ hrv, hrvBaseline, sleep, restingHr }) {
    const parts = [
        { score: hrvScoreFromValue(hrv, hrvBaseline), weight: 0.5 },
        { score: sleepScoreFromValue(sleep), weight: 0.3 },
        { score: restingHrScore(restingHr), weight: 0.2 },
    ].filter((part) => part.score != null);

    if (parts.length === 0) {
        return { score: null, status: null, available: false };
    }

    const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
    const score = Math.round(
        parts.reduce((sum, part) => sum + part.score * part.weight, 0) / totalWeight
    );

    return {
        score,
        status: readyStatus(score),
        available: true,
    };
}

function metric(value, extras = {}) {
    return {
        value,
        available: value != null,
        ...extras,
    };
}

async function latestSamplesByType(userId) {
    const apple = await queryWithHardTimeout(
        `
        SELECT DISTINCT ON (sample_type)
            sample_type,
            value,
            unit,
            start_at,
            'apple_health'::text AS source
        FROM apple_health_samples
        WHERE user_id = $1
          AND sample_type IN ('hrv', 'sleep', 'resting_hr')
        ORDER BY sample_type, start_at DESC
        `,
        [userId],
        8000
    ).catch(() => ({ rows: [] }));

    const zepp = await queryWithHardTimeout(
        `
        SELECT DISTINCT ON (sample_type)
            sample_type,
            value,
            unit,
            start_at,
            'zepp'::text AS source
        FROM zepp_health_samples
        WHERE user_id = $1
          AND sample_type IN ('hrv', 'sleep')
        ORDER BY sample_type, start_at DESC NULLS LAST
        `,
        [userId],
        8000
    ).catch(() => ({ rows: [] }));

    const appleByType = Object.fromEntries(apple.rows.map((row) => [row.sample_type, row]));
    const zeppByType = Object.fromEntries(zepp.rows.map((row) => [row.sample_type, row]));

    return {
        hrv: pickLatest(appleByType.hrv, zeppByType.hrv),
        sleep: pickLatest(appleByType.sleep, zeppByType.sleep),
        restingHr: appleByType.resting_hr || null,
    };
}

async function hrvSevenDayAverage(userId) {
    const { rows } = await queryWithHardTimeout(
        `
        SELECT AVG(value)::numeric AS avg_value
        FROM (
            SELECT value
            FROM apple_health_samples
            WHERE user_id = $1
              AND sample_type = 'hrv'
              AND start_at > NOW() - INTERVAL '7 days'
              AND value IS NOT NULL
            UNION ALL
            SELECT value
            FROM zepp_health_samples
            WHERE user_id = $1
              AND sample_type = 'hrv'
              AND start_at > NOW() - INTERVAL '7 days'
              AND value IS NOT NULL
        ) samples
        `,
        [userId],
        8000
    ).catch(() => ({ rows: [] }));

    return toNumber(rows[0]?.avg_value);
}

async function thisWeekWorkouts(userId, weekStart) {
    const { rows } = await queryWithHardTimeout(
        `
        SELECT
            source,
            DATE(start_at AT TIME ZONE 'UTC') AS day,
            COUNT(*)::int AS workouts,
            COALESCE(SUM(duration_seconds), 0)::int AS duration_seconds,
            COALESCE(SUM(distance), 0)::numeric AS distance,
            COALESCE(SUM(calories), 0)::numeric AS calories
        FROM (
            SELECT
                'zepp'::text AS source,
                start_at,
                duration_seconds,
                distance,
                calories
            FROM zepp_health_samples
            WHERE user_id = $1
              AND sample_type = 'activity'
              AND start_at >= $2
            UNION ALL
            SELECT
                'apple_health'::text AS source,
                start_at,
                CASE
                    WHEN (metadata->>'duration_seconds') ~ '^[0-9]+$'
                    THEN (metadata->>'duration_seconds')::int
                END AS duration_seconds,
                NULLIF(value, 0) AS distance,
                CASE
                    WHEN (metadata->>'calories') ~ '^[0-9]+(\\.[0-9]+)?$'
                    THEN (metadata->>'calories')::numeric
                END AS calories
            FROM apple_health_samples
            WHERE user_id = $1
              AND sample_type = 'workout'
              AND start_at >= $2
            UNION ALL
            SELECT
                'strava'::text AS source,
                start_at,
                moving_time AS duration_seconds,
                distance,
                calories
            FROM strava_activities
            WHERE user_id = $1
              AND start_at >= $2
        ) watch_week
        GROUP BY source, DATE(start_at AT TIME ZONE 'UTC')
        `,
        [userId, weekStart],
        8000
    ).catch(() => ({ rows: [] }));

    return rows;
}

async function thisWeekSteps(userId, weekStart) {
    const { rows } = await queryWithHardTimeout(
        `
        SELECT COALESCE(SUM(value), 0)::numeric AS steps
        FROM apple_health_samples
        WHERE user_id = $1
          AND sample_type = 'steps'
          AND start_at >= $2
        `,
        [userId, weekStart],
        8000
    ).catch(() => ({ rows: [] }));

    return toNumber(rows[0]?.steps) || 0;
}

function buildThisWeek(weekStart, workoutRows, steps) {
    const dayMap = {};
    const sources = new Set();
    let workouts = 0;
    let durationSeconds = 0;
    let distance = 0;
    let calories = 0;

    for (const row of workoutRows) {
        const key = new Date(row.day).toISOString().slice(0, 10);
        if (!dayMap[key]) {
            dayMap[key] = {
                workouts: 0,
                duration_seconds: 0,
                calories: 0,
            };
        }
        dayMap[key].workouts += Number(row.workouts) || 0;
        dayMap[key].duration_seconds += Number(row.duration_seconds) || 0;
        dayMap[key].calories += Number(row.calories) || 0;
        workouts += Number(row.workouts) || 0;
        durationSeconds += Number(row.duration_seconds) || 0;
        distance += Number(row.distance) || 0;
        calories += Number(row.calories) || 0;
        if (row.source) sources.add(row.source);
    }

    const days = [];
    for (let index = 0; index < 7; index += 1) {
        const date = new Date(weekStart);
        date.setUTCDate(date.getUTCDate() + index);
        const key = date.toISOString().slice(0, 10);
        const day = dayMap[key] || {
            workouts: 0,
            duration_seconds: 0,
            calories: 0,
        };
        days.push({
            date: key,
            active: day.workouts > 0,
            workouts: day.workouts,
            duration_seconds: day.duration_seconds,
            calories: Math.round(day.calories),
        });
    }

    const sourceList = [...sources];
    const source =
        sourceList.length === 0 ? null : sourceList.length === 1 ? sourceList[0] : 'watch';

    return {
        week_start: weekStart.toISOString(),
        workouts,
        duration_seconds: durationSeconds,
        distance: Math.round(distance * 100) / 100,
        calories: Math.round(calories),
        steps,
        days,
        source,
        available: workouts > 0 || steps > 0,
    };
}

async function getHomeWatchData(userId) {
    await Promise.all([
        ensureAppleHealthTables().catch(() => {}),
        ensureZeppDataTables().catch(() => {}),
        ensureStravaDataTables().catch(() => {}),
    ]);

    const weekStart = startOfWeekUtc();

    const [latest, hrvBaseline, workoutRows, steps] = await Promise.all([
        latestSamplesByType(userId),
        hrvSevenDayAverage(userId),
        thisWeekWorkouts(userId, weekStart),
        thisWeekSteps(userId, weekStart),
    ]);

    const hrvValue = toNumber(latest.hrv?.value);
    const sleepValue = toNumber(latest.sleep?.value);
    const restingHrValue = toNumber(latest.restingHr?.value);
    const sleepScore = sleepScoreFromValue(sleepValue);

    return {
        this_week: buildThisWeek(weekStart, workoutRows, steps),
        athlete_dna: {
            ready: computeReady({
                hrv: hrvValue,
                hrvBaseline,
                sleep: sleepValue,
                restingHr: restingHrValue,
            }),
            hrv: metric(hrvValue, {
                unit: latest.hrv?.unit || (hrvValue == null ? null : 'ms'),
                source: latest.hrv?.source || null,
                measured_at: latest.hrv?.start_at || null,
            }),
            sleep: metric(sleepValue, {
                score: sleepScore,
                unit: latest.sleep?.unit || null,
                source: latest.sleep?.source || null,
                measured_at: latest.sleep?.start_at || null,
            }),
            resting_hr: metric(restingHrValue, {
                unit: latest.restingHr?.unit || (restingHrValue == null ? null : 'bpm'),
                source: latest.restingHr?.source || null,
                measured_at: latest.restingHr?.start_at || null,
            }),
        },
    };
}

module.exports = { getHomeWatchData };
