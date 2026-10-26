const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { selectWellness } = require('./dailyWellness');
const readinessConfig = require('../../config/readiness.json');

const STATUS_RANK = {
    RECOVERY_NEEDED: 0,
    FATIGUED: 1,
    MODERATE: 2,
    READY: 3,
    PRIMED: 4,
};

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function roundScore(value) {
    return clamp(Math.round(value), 0, 100);
}

function normalizeAnswer(field, value) {
    const number = Number(value);
    const reversed = field === 'soreness' || field === 'stress';
    const aligned = reversed ? 6 - number : number;
    return ((aligned - 1) / 4) * 100;
}

function statusFor(score) {
    const thresholds = [...readinessConfig.statusThresholds].sort((left, right) => right.min - left.min);
    const match = thresholds.find((item) => score >= item.min);
    return match ? match.status : 'RECOVERY_NEEDED';
}

function moderateBandCap() {
    const ready = readinessConfig.statusThresholds.find((item) => item.status === 'READY');
    return ready ? ready.min - 1 : 69;
}

function singleSignalFloor(parts) {
    if (parts.length < 2) return 0;
    let floor = 0;
    for (const part of parts) {
        const others = parts.filter((item) => item !== part);
        const otherWeight = others.reduce((sum, item) => sum + item.weight, 0);
        if (otherWeight <= 0) continue;
        const othersScore = others.reduce((sum, item) => sum + item.score * item.weight, 0) / otherWeight;
        floor = Math.max(floor, othersScore - part.weight * 100);
    }
    return floor;
}

function overallScore(parts, contradicted) {
    const weighted = parts.reduce((sum, part) => sum + part.score * part.weight, 0);
    let score = weighted;
    if (contradicted) {
        score -= Number(readinessConfig.conflictPenalty ?? 15);
        score = Math.min(score, moderateBandCap());
    }
    return Math.max(score, singleSignalFloor(parts));
}

function confidenceFor(parts, contradicted) {
    if (contradicted || parts.length <= 1) return 'LOW';
    const keys = new Set(parts.map((part) => part.key));
    const wearable = keys.has('sleep') || keys.has('hrv') || keys.has('restingHr');
    const load = keys.has('trainingLoad');
    const subjective = keys.has('checkin') || keys.has('lastRpe');
    if (wearable && (load || keys.has('checkin'))) return 'HIGH';
    if (load && subjective) return 'MODERATE';
    return 'LOW';
}

function versusBaseline(today, baseline, higherIsBetter) {
    const current = Number(today);
    const usual = Number(baseline);
    if (!Number.isFinite(current) || !Number.isFinite(usual) || usual === 0) return null;
    const ratio = higherIsBetter ? current / usual : usual / current;
    return clamp(70 + ((ratio - 1) / 0.2) * 30, 0, 100);
}

function hours(minutes) {
    if (minutes == null) return null;
    return Math.round((Number(minutes) / 60) * 10) / 10;
}

function loadLabel(score) {
    const labels = [...(readinessConfig.loadLabels || [])].sort((left, right) => right.min - left.min);
    const match = labels.find((item) => score >= item.min);
    return match ? match.label : null;
}

function activityKey(type) {
    return String(type || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function optionalNumber(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function sessionIntensity(session) {
    const load = readinessConfig.load;
    const rpe = Number(session.rpe);
    if (session.rpe != null && Number.isFinite(rpe)) {
        const neutral = Number(load.rpe?.neutral) || 5;
        return neutral === 0 ? rpe : rpe / neutral;
    }
    const heartRate = Number(session.averageHr);
    const hr = load.heartRate || {};
    const span = Number(hr.maxBpm) - Number(hr.restBpm);
    if (session.averageHr != null && Number.isFinite(heartRate) && span > 0) {
        const scaled = ((heartRate - Number(hr.restBpm)) / span) * (Number(hr.scale) || 1);
        return clamp(scaled, Number(hr.minFactor ?? 0), Number(hr.maxFactor ?? 2));
    }
    const table = load.typeIntensity || {};
    const key = activityKey(session.activityType);
    if (key && table[key] != null) return Number(table[key]);
    return Number(table.default ?? 1);
}

function acuteChronicRatio(acuteLoad, acuteDays, chronicLoad, chronicDays) {
    const acute = Number(acuteLoad);
    const chronic = Number(chronicLoad);
    if (!Number.isFinite(acute) || !Number.isFinite(chronic) || chronic <= 0) return null;
    if (!(acuteDays > 0) || !(chronicDays > 0)) return null;
    const chronicRate = chronic / chronicDays;
    if (chronicRate <= 0) return null;
    return acute / acuteDays / chronicRate;
}

function ratioToReadiness(ratio) {
    const load = readinessConfig.load;
    const neutral = Number(load.neutralScore ?? 70);
    const band = Number(load.ratioBand ?? 0.2);
    const swing = Number(load.scorePerBand ?? 30);
    if (!(ratio > 0) || !(band > 0)) return neutral;
    return clamp(neutral + ((1 / ratio - 1) / band) * swing, 0, 100);
}

function loadScore(load3, load7, load28) {
    const acuteDays = readinessConfig.load.acuteDays || [3, 7];
    const chronicDays = Number(readinessConfig.load.chronicDays ?? 28);
    const windows = [
        { key: 'ratio3', days: Number(acuteDays[0] ?? 3), load: load3 },
        { key: 'ratio7', days: Number(acuteDays[1] ?? 7), load: load7 },
    ];
    const ratios = {};
    const scores = [];
    for (const window of windows) {
        const ratio = acuteChronicRatio(window.load, window.days, load28, chronicDays);
        if (ratio == null) continue;
        ratios[window.key] = ratio;
        scores.push(ratioToReadiness(ratio));
    }
    if (scores.length === 0) return null;
    return {
        score: scores.reduce((sum, value) => sum + value, 0) / scores.length,
        ratio3: ratios.ratio3 ?? null,
        ratio7: ratios.ratio7 ?? null,
    };
}

function debriefScore(rpe, flags) {
    const list = Array.isArray(flags) ? flags : [];
    if (rpe == null && list.length === 0) return null;
    const base = rpe == null ? 70 : clamp(((10 - Number(rpe)) / 9) * 100, 0, 100);
    return clamp(base - list.length * readinessConfig.debrief.flagPenalty, 0, 100);
}

const MIN_COMPLETED_SESSIONS = 3;
const DEDUPE_START_MS = 15 * 60 * 1000;

function baselineDayCount(input, daysKey, baselineKey) {
    if (input[daysKey] != null) return Number(input[daysKey]) || 0;
    const baseline = Number(input[baselineKey]);
    if (!Number.isFinite(baseline)) return 0;
    return Number(readinessConfig.minBaselineDays ?? 4);
}

function wearableBaselineReady(input) {
    const minDays = Number(readinessConfig.minBaselineDays ?? 4);
    return (
        baselineDayCount(input, 'sleepBaselineDays', 'sleepBaselineMinutes') >= minDays ||
        baselineDayCount(input, 'hrvBaselineDays', 'hrvBaselineMs') >= minDays ||
        baselineDayCount(input, 'restingHrBaselineDays', 'restingHrBaseline') >= minDays
    );
}

function readinessUnlocked(input, checkin, completedSessions) {
    return Boolean(checkin) || completedSessions >= MIN_COMPLETED_SESSIONS || wearableBaselineReady(input);
}

function partIsShortBaseline(part, input) {
    if (part.provisional) return true;
    const fullDays = Number(readinessConfig.baselineDays ?? 14);
    const daysKey = {
        sleep: 'sleepBaselineDays',
        hrv: 'hrvBaselineDays',
        restingHr: 'restingHrBaselineDays',
    }[part.key];
    if (!daysKey || input[daysKey] == null) return false;
    const days = Number(input[daysKey]) || 0;
    return days > 0 && days < fullDays;
}

function toMillis(value) {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
}

function normalizeSession(session) {
    const startMs = toMillis(session.startAt ?? session.start_at);
    if (startMs == null) return null;
    const durationMin = Number(session.durationMin ?? session.duration_min);
    const minutes = Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 0;
    return {
        source: session.source || null,
        startMs,
        durationMin: minutes,
        activityType: activityKey(session.activityType ?? session.activity_type ?? session.sport_type),
        rpe: optionalNumber(session.rpe),
        averageHr: optionalNumber(session.averageHr ?? session.average_heartrate),
        countedOn: session.countedOn || new Date(startMs).toISOString().slice(0, 10),
    };
}

function sameWorkout(left, right) {
    if (left.activityType !== right.activityType) return false;
    const gap = Math.abs(left.startMs - right.startMs);
    if (gap > DEDUPE_START_MS) return false;
    const overlap = Math.min(left.startMs + left.durationMin * 60000, right.startMs + right.durationMin * 60000)
        - Math.max(left.startMs, right.startMs);
    const shorter = Math.min(left.durationMin, right.durationMin);
    if (shorter <= 0 || overlap <= 0) return false;
    return overlap >= shorter * 60000 * 0.5;
}

function dedupeSessions(sessions) {
    const unique = [];
    for (const session of sessions) {
        const normalized = normalizeSession(session);
        if (!normalized) continue;
        const match = unique.find((existing) => sameWorkout(existing, normalized));
        if (!match) {
            unique.push(normalized);
            continue;
        }
        if (normalized.durationMin > match.durationMin) match.durationMin = normalized.durationMin;
        if (match.rpe == null && normalized.rpe != null) match.rpe = normalized.rpe;
        if (match.averageHr == null && normalized.averageHr != null) match.averageHr = normalized.averageHr;
    }
    return unique;
}

function calendarDaysBefore(localDate, countedOn) {
    const end = Date.parse(`${localDate}T00:00:00Z`);
    const start = Date.parse(`${countedOn}T00:00:00Z`);
    if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
    return Math.round((end - start) / 86400000);
}

function summarizeSessions(sessions, localDate) {
    const unique = dedupeSessions(sessions);
    const acuteDays = readinessConfig.load.acuteDays || [3, 7];
    const shortWindow = Number(acuteDays[0] ?? 3);
    const weekWindow = Number(acuteDays[1] ?? 7);
    const chronicDays = Number(readinessConfig.load.chronicDays ?? 28);
    let load3 = 0;
    let load7 = 0;
    let load28 = 0;
    for (const session of unique) {
        const daysAgo = calendarDaysBefore(localDate, session.countedOn);
        if (daysAgo == null || daysAgo < 0) continue;
        const load = session.durationMin * sessionIntensity(session);
        if (daysAgo < shortWindow) load3 += load;
        if (daysAgo < weekWindow) load7 += load;
        if (daysAgo < chronicDays) load28 += load;
    }
    const hasSessions = unique.length > 0;
    return {
        completedSessions: unique.length,
        load3: hasSessions ? load3 : null,
        load7: hasSessions ? load7 : null,
        load28: hasSessions ? load28 : null,
    };
}

function metadataObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function rowActivityType(row) {
    if (row.activity_type || row.sport_type) return row.activity_type || row.sport_type;
    const meta = metadataObject(row.metadata);
    return meta.sport_type || meta.sportType || meta.activity_type || meta.activityType || null;
}

function rowHeartRate(row) {
    const direct = optionalNumber(row.average_heartrate);
    if (direct != null) return direct;
    const meta = metadataObject(row.metadata);
    return optionalNumber(meta.average_heartrate ?? meta.averageHeartRate);
}

function nativeActivityType(workoutId) {
    if (!workoutId) return 'workout';
    try {
        const { workoutById } = require('../onboarding/programCatalog');
        if (workoutById(workoutId)?.category) return workoutById(workoutId).category;
    } catch (_) {
        /* program catalog is optional for imported sessions */
    }
    try {
        const { getWorkout } = require('../workouts/workoutCatalog');
        if (getWorkout(workoutId)?.type) return getWorkout(workoutId).type;
    } catch (_) {
        /* workout catalog is optional for imported sessions */
    }
    return 'workout';
}

function sessionFromRow(row, source) {
    if (!row) return null;
    if (source === 'roxclub') {
        const durationMin = Number(row.duration_min) || 0;
        const endMs = toMillis(row.completed_at);
        if (endMs == null) return null;
        return {
            source,
            startAt: new Date(endMs - durationMin * 60000).toISOString(),
            durationMin,
            activityType: nativeActivityType(row.workout_id),
            countedOn: new Date(endMs).toISOString().slice(0, 10),
        };
    }
    const startMs = toMillis(row.start_at);
    if (startMs == null) return null;
    let durationMin = 0;
    if (row.duration_seconds != null && row.duration_seconds !== '') {
        durationMin = Number(row.duration_seconds) / 60;
    } else if (row.end_at) {
        const endMs = toMillis(row.end_at);
        if (endMs != null && endMs > startMs) durationMin = (endMs - startMs) / 60000;
    }
    if (!Number.isFinite(durationMin) || durationMin < 0) durationMin = 0;
    return {
        source,
        startAt: new Date(startMs).toISOString(),
        durationMin,
        activityType: rowActivityType(row),
        averageHr: rowHeartRate(row),
        countedOn: new Date(startMs).toISOString().slice(0, 10),
    };
}

function attachDebriefs(sessions, debriefs) {
    const hours = Number(readinessConfig.load.debriefMatchHours ?? 12);
    const windowMs = hours * 60 * 60 * 1000;
    for (const debrief of debriefs || []) {
        const rpe = Number(debrief.rpe);
        const at = toMillis(debrief.created_at);
        if (!Number.isFinite(rpe) || at == null) continue;
        let best = null;
        let bestGap = Infinity;
        for (const session of sessions) {
            if (session.rpe != null) continue;
            const start = toMillis(session.startAt);
            if (start == null) continue;
            const end = start + (Number(session.durationMin) || 0) * 60000;
            if (at < start) continue;
            const gap = at - end;
            if (gap > windowMs) continue;
            if (gap < bestGap) {
                best = session;
                bestGap = gap;
            }
        }
        if (best) best.rpe = rpe;
    }
    return sessions;
}

function computeReadiness(input = {}) {
    const completedSessions = Number(input.completedSessions) || 0;
    const checkin = input.checkin || null;
    const signalsUsed = {
        formula: readinessConfig.todo,
        completedSessions,
        contradiction: false,
        signals: [],
    };

    if (!readinessUnlocked(input, checkin, completedSessions)) {
        return {
            score: null,
            status: 'CALIBRATING',
            confidence: 'LOW',
            signalsUsed,
            modelVersion: readinessConfig.modelVersion,
        };
    }

    const parts = [];
    const configured = readinessConfig.weights;

    if (checkin) {
        const normalized = {
            energy: normalizeAnswer('energy', checkin.energy),
            soreness: normalizeAnswer('soreness', checkin.soreness),
            sleepQuality: normalizeAnswer('sleepQuality', checkin.sleepQuality ?? checkin.sleep_quality),
            stress: normalizeAnswer('stress', checkin.stress),
        };
        const score =
            (normalized.energy + normalized.soreness + normalized.sleepQuality + normalized.stress) / 4;
        parts.push({
            key: 'checkin',
            score,
            configuredWeight: configured.checkin,
            value: roundScore(score),
            unit: 'score',
            baseline: null,
            energy: checkin.energy,
            soreness: checkin.soreness,
            sleepQuality: checkin.sleepQuality ?? checkin.sleep_quality,
            stress: checkin.stress,
        });
    }

    const scoredLoad = loadScore(input.load3, input.load7, input.load28);
    if (scoredLoad) {
        parts.push({
            key: 'trainingLoad',
            score: scoredLoad.score,
            configuredWeight: configured.trainingLoad,
            value: scoredLoad.ratio7 ?? scoredLoad.ratio3,
            unit: 'ratio',
            baseline: 1,
            label: loadLabel(scoredLoad.score),
            load3: input.load3 ?? null,
            load7: input.load7 ?? null,
            load28: input.load28 ?? null,
            ratio3: scoredLoad.ratio3,
            ratio7: scoredLoad.ratio7,
        });
    }

    const debrief = debriefScore(input.lastRpe, input.flags);
    if (debrief != null) {
        parts.push({
            key: 'lastRpe',
            score: debrief,
            configuredWeight: configured.lastRpe,
            value: input.lastRpe ?? null,
            unit: 'rpe',
            baseline: null,
            flags: input.flags || [],
        });
    }

    const sleep = versusBaseline(input.sleepMinutes, input.sleepBaselineMinutes, true);
    if (sleep != null) {
        parts.push({
            key: 'sleep',
            score: sleep,
            configuredWeight: configured.sleep,
            value: hours(input.sleepMinutes),
            unit: 'hrs',
            baseline: hours(input.sleepBaselineMinutes),
            source: input.wellnessSource || null,
            provisional: Boolean(input.sleepProvisional),
        });
    }

    const hrv = versusBaseline(input.hrvMs, input.hrvBaselineMs, true);
    if (hrv != null) {
        parts.push({
            key: 'hrv',
            score: hrv,
            configuredWeight: configured.hrv,
            value: Number(input.hrvMs),
            unit: 'ms',
            baseline: Number(input.hrvBaselineMs),
            source: input.wellnessSource || null,
            provisional: Boolean(input.hrvProvisional),
        });
    }

    const resting = versusBaseline(input.restingHr, input.restingHrBaseline, false);
    if (resting != null) {
        parts.push({
            key: 'restingHr',
            score: resting,
            configuredWeight: configured.restingHr,
            value: Number(input.restingHr),
            unit: 'bpm',
            baseline: Number(input.restingHrBaseline),
            source: input.wellnessSource || null,
            provisional: Boolean(input.restingHrProvisional),
        });
    }

    if (parts.length === 0) {
        return {
            score: null,
            status: 'CALIBRATING',
            confidence: 'LOW',
            signalsUsed,
            modelVersion: readinessConfig.modelVersion,
        };
    }

    const configuredTotal = parts.reduce((sum, part) => sum + part.configuredWeight, 0);
    for (const part of parts) {
        part.weight = part.configuredWeight / configuredTotal;
    }

    const spread = Math.max(...parts.map((part) => part.score)) - Math.min(...parts.map((part) => part.score));
    const contradicted = parts.length > 1 && spread >= readinessConfig.contradictionGap;
    signalsUsed.contradiction = contradicted;
    signalsUsed.signals = parts.map((part) => ({
        key: part.key,
        value: part.value,
        unit: part.unit,
        baseline: part.baseline,
        weight: part.weight,
        score: roundScore(part.score),
        ...(part.provisional ? { provisional: true } : {}),
        ...(part.label ? { label: part.label } : {}),
        ...(part.source ? { source: part.source } : {}),
        ...(part.load3 != null || part.load7 != null
            ? {
                  load3: part.load3,
                  load7: part.load7,
                  load28: part.load28,
                  ratio3: part.ratio3,
                  ratio7: part.ratio7,
              }
            : {}),
        ...(part.energy != null
            ? {
                  energy: part.energy,
                  soreness: part.soreness,
                  sleepQuality: part.sleepQuality,
                  stress: part.stress,
              }
            : {}),
        ...(part.flags ? { flags: part.flags } : {}),
    }));
    let confidence = confidenceFor(parts, contradicted);
    const provisionalBaseline = parts.some((part) => part.provisional || partIsShortBaseline(part, input));
    if (provisionalBaseline && confidence === 'HIGH') confidence = 'MODERATE';
    else if (provisionalBaseline && confidence === 'LOW' && !contradicted && parts.length > 1) {
        confidence = 'MODERATE';
    }

    const score = roundScore(overallScore(parts, contradicted));

    return {
        score,
        status: statusFor(score),
        confidence,
        signalsUsed,
        modelVersion: readinessConfig.modelVersion,
    };
}

async function optionalQuery(query, sql, params) {
    try {
        return await query(sql, params, 8000);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return { rows: [] };
        throw error;
    }
}

async function gatherSignals(userId, localDate, query) {
    const [native, strava, apple, zepp, debrief, wellness, checkinRow] = await Promise.all([
        optionalQuery(
            query,
            `
            /* readiness:sessions_native */
            SELECT completed_at, duration_min, workout_id
            FROM scheduled_sessions
            WHERE user_id = $1 AND completed_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* readiness:sessions_strava */
            SELECT start_at,
                   COALESCE(moving_time, elapsed_time, 0) AS duration_seconds,
                   COALESCE(sport_type, activity_type) AS activity_type,
                   average_heartrate
            FROM strava_activities
            WHERE user_id = $1 AND start_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* readiness:sessions_apple */
            SELECT start_at, end_at, metadata
            FROM apple_health_samples
            WHERE user_id = $1 AND sample_type = 'workout' AND start_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* readiness:sessions_zepp */
            SELECT start_at,
                   COALESCE(duration_seconds, 0) AS duration_seconds,
                   sport_type AS activity_type,
                   average_heartrate
            FROM zepp_health_samples
            WHERE user_id = $1 AND sample_type = 'activity' AND start_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* readiness:debrief */
            SELECT rpe, flags, created_at
            FROM session_debriefs
            WHERE user_id = $1
            ORDER BY created_at DESC
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* readiness:wellness */
            SELECT source, local_date::text AS local_date, sleep_minutes, hrv_ms, resting_hr
            FROM daily_wellness
            WHERE user_id = $1
              AND local_date <= $2::date
              AND local_date >= $2::date - $3::int
            `,
            [userId, localDate, readinessConfig.baselineDays]
        ),
        optionalQuery(
            query,
            `
            /* readiness:checkin_row */
            SELECT energy, soreness, sleep_quality, stress
            FROM readiness_checkins
            WHERE user_id = $1 AND local_date = $2::date
            `,
            [userId, localDate]
        ),
    ]);

    const sessions = attachDebriefs(
        [
            ...native.rows.map((row) => sessionFromRow(row, 'roxclub')),
            ...strava.rows.map((row) => sessionFromRow(row, 'strava')),
            ...apple.rows.map((row) => sessionFromRow(row, 'apple_health')),
            ...zepp.rows.map((row) => sessionFromRow(row, 'zepp')),
        ].filter(Boolean),
        debrief.rows
    );
    const { completedSessions, load3, load7, load28 } = summarizeSessions(sessions, localDate);
    const wearable = selectWellness(wellness.rows, localDate);
    const saved = checkinRow.rows[0];

    return {
        completedSessions,
        load3,
        load7,
        load28,
        lastRpe: debrief.rows[0]?.rpe ?? null,
        flags: debrief.rows[0]?.flags || null,
        wellnessSource: wearable.source,
        sleepMinutes: wearable.sleepMinutes,
        sleepBaselineMinutes: wearable.sleepBaselineMinutes,
        sleepBaselineDays: wearable.sleepBaselineDays,
        hrvMs: wearable.hrvMs,
        hrvBaselineMs: wearable.hrvBaselineMs,
        hrvBaselineDays: wearable.hrvBaselineDays,
        hrvProvisional: wearable.hrvProvisional,
        restingHr: wearable.restingHr,
        restingHrBaseline: wearable.restingHrBaseline,
        restingHrBaselineDays: wearable.restingHrBaselineDays,
        restingHrProvisional: wearable.restingHrProvisional,
        sleepProvisional: wearable.sleepProvisional,
        checkin: saved
            ? {
                  energy: saved.energy,
                  soreness: saved.soreness,
                  sleepQuality: saved.sleep_quality,
                  stress: saved.stress,
              }
            : null,
    };
}

function toReadiness(row) {
    if (!row) return null;
    const idNumber = Number(row.id);
    return {
        id: Number.isSafeInteger(idNumber) ? idNumber : row.id,
        localDate: row.local_date,
        score: row.score == null ? null : Number(row.score),
        status: row.status,
        confidence: row.confidence,
        signalsUsed: row.signals_used || {},
        modelVersion: row.model_version,
        computedAt:
            row.computed_at instanceof Date ? row.computed_at.toISOString() : row.computed_at || null,
    };
}

async function storeReadiness(userId, localDate, result, query) {
    const { rows } = await query(
        `
        /* readiness:upsert_readiness */
        INSERT INTO daily_readiness (
            user_id, local_date, score, status, confidence, signals_used, model_version, computed_at
        )
        VALUES ($1, $2::date, $3, $4, $5, $6::jsonb, $7, NOW())
        ON CONFLICT (user_id, local_date)
        DO UPDATE SET
            score = EXCLUDED.score,
            status = EXCLUDED.status,
            confidence = EXCLUDED.confidence,
            signals_used = EXCLUDED.signals_used,
            model_version = EXCLUDED.model_version,
            computed_at = NOW()
        RETURNING id, local_date::text AS local_date, score, status, confidence,
                  signals_used, model_version, computed_at
        `,
        [
            userId,
            localDate,
            result.score,
            result.status,
            result.confidence,
            JSON.stringify(result.signalsUsed),
            result.modelVersion,
        ],
        8000
    );
    return toReadiness(rows[0]);
}

async function recomputeAndStore(userId, localDate, query = queryWithHardTimeout, gather = gatherSignals) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const { isoDate } = require('../onboarding/schedule');
    const today = localDate || isoDate('UTC');
    const signals = await gather(userId, today, query);
    const result = computeReadiness(signals);
    return storeReadiness(userId, today, result, query);
}

function timeOf(value) {
    if (!value) return null;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(time) ? time : null;
}

function readinessIsStale(computedAt, latestInputAt) {
    const computed = timeOf(computedAt);
    if (computed == null) return true;
    const latest = timeOf(latestInputAt);
    if (latest == null) return false;
    return latest > computed;
}

async function latestReadinessInputAt(userId, localDate, query) {
    const probes = [
        [
            'checkin',
            `
            SELECT MAX(updated_at) AS at
            FROM readiness_checkins
            WHERE user_id = $1 AND local_date = $2::date
            `,
            [userId, localDate],
        ],
        [
            'sync',
            `
            SELECT MAX(last_synced_at) AS at
            FROM user_integrations
            WHERE user_id = $1
            `,
            [userId],
        ],
        [
            'workout',
            `
            SELECT MAX(completed_at) AS at
            FROM scheduled_sessions
            WHERE user_id = $1 AND completed_at IS NOT NULL
            `,
            [userId],
        ],
        [
            'strava',
            `
            SELECT MAX(updated_at) AS at
            FROM strava_activities
            WHERE user_id = $1
            `,
            [userId],
        ],
        [
            'apple',
            `
            SELECT MAX(updated_at) AS at
            FROM apple_health_samples
            WHERE user_id = $1 AND sample_type = 'workout'
            `,
            [userId],
        ],
        [
            'zepp',
            `
            SELECT MAX(updated_at) AS at
            FROM zepp_health_samples
            WHERE user_id = $1 AND sample_type = 'activity'
            `,
            [userId],
        ],
        [
            'wellness',
            `
            SELECT MAX(synced_at) AS at
            FROM daily_wellness
            WHERE user_id = $1 AND local_date <= $2::date
            `,
            [userId, localDate],
        ],
    ];
    let latest = null;
    for (const [name, sql, params] of probes) {
        const { rows } = await optionalQuery(query, `/* readiness:newer_input:${name} */ ${sql}`, params);
        const at = rows[0]?.at;
        if (timeOf(at) != null && (latest == null || timeOf(at) > timeOf(latest))) latest = at;
    }
    return latest;
}

async function ensureTodayReadiness(userId, localDate, query = queryWithHardTimeout, gather = gatherSignals) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const current = await readinessHistory(userId, localDate, query);
    const latest = await latestReadinessInputAt(userId, localDate, query);
    if (current.today && !readinessIsStale(current.today.computedAt, latest)) return current;
    await recomputeAndStore(userId, localDate, query, gather);
    return readinessHistory(userId, localDate, query);
}

async function readinessHistory(userId, localDate, query = queryWithHardTimeout) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const { rows } = await query(
        `
        /* readiness:history */
        SELECT id, local_date::text AS local_date, score, status, confidence,
               signals_used, model_version, computed_at
        FROM daily_readiness
        WHERE user_id = $1
          AND local_date <= $2::date
          AND local_date > $2::date - 14
        ORDER BY local_date DESC
        `,
        [userId, localDate],
        8000
    );
    const history = rows.map(toReadiness);
    const today = history.find((row) => row.localDate === localDate) || null;
    return {
        today,
        history,
        signalsUsed: today?.signalsUsed || null,
    };
}

module.exports = {
    normalizeAnswer,
    computeReadiness,
    summarizeSessions,
    gatherSignals,
    readinessIsStale,
    ensureTodayReadiness,
    recomputeAndStore,
    readinessHistory,
    toReadiness,
    STATUS_RANK,
};
