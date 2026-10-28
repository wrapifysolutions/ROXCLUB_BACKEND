const crypto = require('crypto');
const { query: dbQuery, withTransaction } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { getWorkout } = require('../workouts/workoutCatalog');
const { sameWorkout, normalizeSession } = require('../readiness/readinessService');
const { enqueueReadinessRecompute } = require('../readiness/recomputeQueue');
const { playerActivities, workActivities, ROXZONE_TARGET_SEC } = require('./playerPlan');
const {
    buildXp,
    coinsFor,
    levelState,
    nextStreak,
    evidenceStatus,
    buildEvidence,
    badgeRewards,
    missionRewards,
    streakReward,
    xpConfig,
} = require('./xpService');
const { queueActivityRecorded } = require('./activityJobs');

const WATCH_RANK = { zepp: 0, apple_health: 1, strava: 2 };

function httpError(code, status, extra = {}) {
    const error = new Error(extra.message || code);
    error.code = code;
    error.status = status;
    Object.assign(error, extra);
    return error;
}

function asObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function numberOrNull(value) {
    if (value == null || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function requireNumber(value, field) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw httpError('INVALID_PROGRESS', 400, { message: `${field} must be a non-negative number` });
    }
    return number;
}

async function ready(options) {
    if (options.query) return;
    await ensureOnboardingProfileSchema();
}

async function optionalQuery(query, sql, params) {
    try {
        return await query(sql, params);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return { rows: [] };
        throw error;
    }
}

function workoutOrThrow(workoutId) {
    const workout = getWorkout(workoutId);
    if (!workout) throw httpError('WORKOUT_NOT_FOUND', 404, { message: 'Workout not found' });
    return workout;
}

function cleanGps(point) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw httpError('INVALID_PROGRESS', 400, { message: 'gps point needs lat and lng' });
    }
    return { lat, lng, ts: point.ts || null, altitude: numberOrNull(point.altitude) };
}

function cleanSets(sets) {
    if (!Array.isArray(sets) || sets.length === 0) {
        throw httpError('INVALID_PROGRESS', 400, { message: 'detailed strength needs sets' });
    }
    return sets.map((set, index) => ({
        setNo: Number(set.setNo ?? index + 1),
        kg: requireNumber(set.kg, 'kg'),
        reps: requireNumber(set.reps, 'reps'),
        rpe: numberOrNull(set.rpe),
        restSec: numberOrNull(set.restSec),
    }));
}

function cleanProgress(entry, plan) {
    const index = Number(entry?.index ?? entry?.activityIndex ?? entry?.activity_index);
    if (!Number.isInteger(index) || index < 0 || index >= plan.length) {
        throw httpError('INVALID_PROGRESS', 400, { message: 'activity index is outside this workout' });
    }
    const planned = plan[index];
    if (entry.kind !== planned.kind) {
        throw httpError('INVALID_PROGRESS', 400, { message: `activity ${index} is ${planned.kind}` });
    }
    const data = asObject(entry.data);
    const cleaned = {};
    if (planned.kind === 'run') {
        cleaned.durationSec = requireNumber(data.durationSec, 'durationSec');
        cleaned.distanceM = requireNumber(data.distanceM, 'distanceM');
        if (!['gps', 'manual'].includes(data.inputMethod)) {
            throw httpError('INVALID_PROGRESS', 400, { message: 'run inputMethod must be gps or manual' });
        }
        cleaned.inputMethod = data.inputMethod;
        cleaned.avgPaceSecPerKm = numberOrNull(data.avgPaceSecPerKm);
        cleaned.kmSplits = Array.isArray(data.kmSplits) ? data.kmSplits : [];
        cleaned.cadence = numberOrNull(data.cadence);
        cleaned.avgHr = numberOrNull(data.avgHr);
        cleaned.gpsPoints = Array.isArray(data.gpsPoints) ? data.gpsPoints.map(cleanGps) : [];
    } else if (planned.kind === 'roxzone') {
        cleaned.durationSec = requireNumber(data.durationSec, 'durationSec');
        cleaned.targetSec = numberOrNull(data.targetSec) ?? ROXZONE_TARGET_SEC;
    } else if (planned.kind === 'station') {
        cleaned.durationSec = requireNumber(data.durationSec, 'durationSec');
        if (!['tap', 'manual', 'timer'].includes(data.inputMethod)) {
            throw httpError('INVALID_PROGRESS', 400, { message: 'station inputMethod must be tap, manual, or timer' });
        }
        cleaned.inputMethod = data.inputMethod;
        cleaned.reps = numberOrNull(data.reps);
        cleaned.distanceM = numberOrNull(data.distanceM);
        cleaned.loadKg = numberOrNull(data.loadKg);
        cleaned.repRate = numberOrNull(data.repRate);
        cleaned.avgHr = numberOrNull(data.avgHr);
    } else if (planned.kind === 'strength_exercise') {
        if (!['simple', 'detailed'].includes(data.mode)) {
            throw httpError('INVALID_PROGRESS', 400, { message: 'strength mode must be simple or detailed' });
        }
        cleaned.mode = data.mode;
        cleaned.durationSec = numberOrNull(data.durationSec);
        cleaned.avgHr = numberOrNull(data.avgHr);
        cleaned.inputMethod = data.inputMethod || null;
        cleaned.sets = data.mode === 'detailed' ? cleanSets(data.sets) : [];
    } else if (planned.kind === 'recovery_block') {
        cleaned.durationSec = requireNumber(data.durationSec, 'durationSec');
    }
    return {
        activityIndex: index,
        kind: planned.kind,
        name: planned.name,
        label: planned.label,
        data: cleaned,
        completedAt: new Date().toISOString(),
    };
}

function startPayload(session, workout) {
    return {
        sessionId: session.id,
        status: session.status,
        workoutId: session.workout_id,
        startedAt: session.started_at,
        pausedDurationSec: Number(session.paused_duration_sec) || 0,
        activities: playerActivities(workout),
    };
}

async function startSession(userId, body, options = {}) {
    await ready(options);
    const query = options.query || dbQuery;
    const workoutId = String(body?.workoutId || '').trim();
    const idempotencyKey = String(body?.idempotencyKey || '').trim();
    if (!workoutId) throw httpError('INVALID_SESSION', 400, { message: 'workoutId is required' });
    if (!idempotencyKey) throw httpError('INVALID_SESSION', 400, { message: 'idempotencyKey is required' });
    const workout = workoutOrThrow(workoutId);
    const startedAt = body.startedAt || new Date().toISOString();

    const existing = await query(
        `
        /* workout:session_by_key */
        SELECT id, user_id, workout_id, scheduled_session_id, status, started_at, paused_duration_sec,
               local_date, result
        FROM workout_sessions
        WHERE user_id = $1 AND idempotency_key = $2
        `,
        [userId, idempotencyKey]
    );
    if (existing.rows[0]) {
        const current = workoutOrThrow(existing.rows[0].workout_id);
        return startPayload(existing.rows[0], current);
    }

    const active = await query(
        `
        /* workout:active_session */
        SELECT id
        FROM workout_sessions
        WHERE user_id = $1 AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
        `,
        [userId]
    );
    if (active.rows[0]) {
        throw httpError('SESSION_IN_PROGRESS', 409, { sessionId: active.rows[0].id });
    }

    let scheduledSessionId = body.scheduledSessionId || body.scheduled_session_id || null;
    if (scheduledSessionId) {
        const owned = await query(
            `
            /* workout:scheduled_owner */
            SELECT id FROM scheduled_sessions WHERE id = $1 AND user_id = $2
            `,
            [scheduledSessionId, userId]
        );
        if (!owned.rows[0]) {
            throw httpError('UNKNOWN_SCHEDULED_SESSION', 400, { message: 'Scheduled session not found' });
        }
    } else {
        scheduledSessionId = null;
    }

    const id = crypto.randomUUID();
    const inserted = await query(
        `
        /* workout:insert_session */
        INSERT INTO workout_sessions (
            id, user_id, workout_id, scheduled_session_id, status, started_at, idempotency_key, local_date
        )
        VALUES ($1, $2, $3, $4, 'in_progress', $5, $6, $7::date)
        RETURNING id, workout_id, status, started_at, paused_duration_sec
        `,
        [id, userId, workoutId, scheduledSessionId, startedAt, idempotencyKey, options.localDate || null]
    );
    return startPayload(inserted.rows[0], workout);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
    return UUID_RE.test(String(value || '').trim());
}

async function resolveSessionId(query, userId, sessionId) {
    const raw = String(sessionId || '').trim();
    if (isUuid(raw)) return raw;
    const { rows } = await query(
        `
        /* workout:session_by_workout */
        SELECT id
        FROM workout_sessions
        WHERE user_id = $1 AND workout_id = $2 AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
        `,
        [userId, raw]
    );
    if (!rows[0]) {
        throw httpError('SESSION_NOT_FOUND', 404, {
            message: 'No in-progress session for this workout. Start it, then use sessionId or the workout id.',
        });
    }
    return rows[0].id;
}

async function loadOwned(query, userId, sessionId) {
    const id = await resolveSessionId(query, userId, sessionId);
    const { rows } = await query(
        `
        /* workout:load_session */
        SELECT id, user_id, workout_id, scheduled_session_id, status, started_at, ended_at,
               total_duration_sec, paused_duration_sec, idempotency_key, activity_id, local_date, result
        FROM workout_sessions
        WHERE id = $1 AND user_id = $2
        `,
        [id, userId]
    );
    if (!rows[0]) throw httpError('SESSION_NOT_FOUND', 404, { message: 'Session not found' });
    return rows[0];
}

function storedResult(session) {
    if (!session?.result) return null;
    return typeof session.result === 'string' ? JSON.parse(session.result) : session.result;
}

async function getActiveSession(userId, options = {}) {
    await ready(options);
    const query = options.query || dbQuery;
    const { rows } = await query(
        `
        /* workout:active_session */
        SELECT id, user_id, workout_id, scheduled_session_id, status, started_at, paused_duration_sec, local_date
        FROM workout_sessions
        WHERE user_id = $1 AND status = 'in_progress'
        ORDER BY started_at DESC
        LIMIT 1
        `,
        [userId]
    );
    const session = rows[0];
    if (!session) return { session: null };
    const workout = workoutOrThrow(session.workout_id);
    const progress = await query(
        `
        /* workout:load_progress */
        SELECT activity_index, kind, data, completed_at
        FROM workout_session_progress
        WHERE session_id = $1
        ORDER BY activity_index
        `,
        [session.id]
    );
    return {
        session: {
            sessionId: session.id,
            status: session.status,
            workoutId: session.workout_id,
            scheduledSessionId: session.scheduled_session_id,
            startedAt: session.started_at,
            pausedDurationSec: Number(session.paused_duration_sec) || 0,
            activities: playerActivities(workout),
            progress: progress.rows.map((row) => ({
                activityIndex: Number(row.activity_index),
                kind: row.kind,
                data: asObject(row.data),
                completedAt: row.completed_at,
            })),
        },
    };
}

async function saveProgress(userId, sessionId, body, options = {}) {
    await ready(options);
    const query = options.query || dbQuery;
    const session = await loadOwned(query, userId, sessionId);
    if (session.status !== 'in_progress') {
        throw httpError('SESSION_NOT_IN_PROGRESS', 400, { message: 'Session is not in progress' });
    }
    const workout = workoutOrThrow(session.workout_id);
    const plan = playerActivities(workout);
    const cleaned = cleanProgress(body, plan);
    await query(
        `
        /* workout:upsert_progress */
        INSERT INTO workout_session_progress (id, session_id, activity_index, kind, data, completed_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6)
        ON CONFLICT (session_id, activity_index)
        DO UPDATE SET kind = EXCLUDED.kind, data = EXCLUDED.data, completed_at = EXCLUDED.completed_at
        `,
        [
            crypto.randomUUID(),
            session.id,
            cleaned.activityIndex,
            cleaned.kind,
            JSON.stringify(cleaned.data),
            cleaned.completedAt,
        ]
    );
    let pausedDurationSec = Number(session.paused_duration_sec) || 0;
    if (body?.pausedDurationSec != null && body?.pausedDurationSec !== '') {
        const paused = Number(body.pausedDurationSec);
        if (!Number.isFinite(paused) || paused < 0) {
            throw httpError('INVALID_PROGRESS', 400, { message: 'pausedDurationSec must be a non-negative number' });
        }
        pausedDurationSec = paused;
        await query(
            `
            /* workout:save_paused */
            UPDATE workout_sessions
            SET paused_duration_sec = $3, updated_at = NOW()
            WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
            `,
            [session.id, userId, pausedDurationSec]
        );
    }
    return {
        sessionId: session.id,
        activityIndex: cleaned.activityIndex,
        kind: cleaned.kind,
        saved: true,
        pausedDurationSec,
    };
}

async function cancelSession(userId, sessionId, options = {}) {
    await ready(options);
    const query = options.query || dbQuery;
    const session = await loadOwned(query, userId, sessionId);
    if (session.status === 'cancelled') return { sessionId: session.id, status: 'cancelled' };
    if (session.status !== 'in_progress') {
        throw httpError('SESSION_NOT_CANCELLABLE', 400, { message: 'Session can no longer be cancelled' });
    }
    await query(
        `
        /* workout:cancel_session */
        UPDATE workout_sessions
        SET status = 'cancelled', ended_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'in_progress'
        `,
        [session.id, userId]
    );
    return { sessionId: session.id, status: 'cancelled' };
}

function deviceNameFrom(row) {
    const payload = asObject(row?.raw);
    const device = asObject(payload.device);
    const gear = asObject(payload.gear);
    const name =
        row?.device_name ||
        row?.deviceName ||
        row?.source_name ||
        row?.sourceName ||
        payload.deviceName ||
        payload.device_name ||
        payload.deviceSource ||
        payload.sourceName ||
        payload.source_name ||
        (typeof payload.device === 'string' ? payload.device : device.name || device.deviceName) ||
        gear.name ||
        null;
    const text = name == null ? '' : String(name).trim();
    return text || null;
}

function normalizeImport(row) {
    const raw = asObject(row.raw);
    return {
        source: row.source,
        externalId: row.external_id == null ? null : String(row.external_id),
        activityType: row.activity_type || row.sport_type || null,
        startAt: row.start_at,
        durationSec: Number(row.duration_seconds ?? row.duration_sec ?? 0),
        averageHr: numberOrNull(row.average_heartrate ?? row.averageHr ?? raw.average_heartrate),
        hrv: numberOrNull(row.hrv ?? raw.hrv),
        cadence: numberOrNull(row.cadence ?? raw.cadence ?? raw.average_cadence),
        hasGps: row.has_gps === true || row.hasGps === true || raw.has_gps === true || raw.hasGps === true,
        deviceName: deviceNameFrom(row),
    };
}

function normalizeApple(row) {
    const meta = asObject(row.metadata);
    const start = new Date(row.start_at).getTime();
    const end = row.end_at ? new Date(row.end_at).getTime() : null;
    const durationSec =
        numberOrNull(meta.duration_seconds ?? meta.durationSeconds) ??
        (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 1000 : 0);
    return {
        source: 'apple_health',
        externalId: row.external_id == null ? null : String(row.external_id),
        activityType: meta.sport_type || meta.sportType || meta.activity_type || meta.activityType || null,
        startAt: row.start_at,
        durationSec,
        averageHr: numberOrNull(meta.average_heartrate ?? meta.averageHeartRate),
        hrv: numberOrNull(meta.hrv),
        cadence: numberOrNull(meta.cadence),
        hasGps: meta.has_gps === true || meta.hasGps === true,
        deviceName: deviceNameFrom({ ...row, raw: { ...meta, ...asObject(row.raw) } }),
    };
}

async function loadImports(userId, query) {
    const [zepp, strava, apple] = await Promise.all([
        optionalQuery(
            query,
            `
            /* workout:import_zepp */
            SELECT 'zepp' AS source, external_id, sport_type AS activity_type, start_at,
                   COALESCE(duration_seconds, 0) AS duration_seconds, average_heartrate, raw
            FROM zepp_health_samples
            WHERE user_id = $1 AND sample_type = 'activity' AND start_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* workout:import_strava */
            SELECT 'strava' AS source, strava_activity_id::text AS external_id,
                   COALESCE(sport_type, activity_type) AS activity_type, start_at,
                   COALESCE(moving_time, elapsed_time, 0) AS duration_seconds, average_heartrate, raw
            FROM strava_activities
            WHERE user_id = $1 AND start_at IS NOT NULL
            `,
            [userId]
        ),
        optionalQuery(
            query,
            `
            /* workout:import_apple */
            SELECT external_id, start_at, end_at, source_name, metadata
            FROM apple_health_samples
            WHERE user_id = $1 AND sample_type = 'workout' AND start_at IS NOT NULL
            `,
            [userId]
        ),
    ]);
    return [...zepp.rows.map(normalizeImport), ...strava.rows.map(normalizeImport), ...apple.rows.map(normalizeApple)];
}

function matchingImports(workout, session, totalDurationSec, imports) {
    const native = normalizeSession({
        source: 'ROXCLUB_NATIVE',
        startAt: session.started_at,
        durationMin: Number(totalDurationSec) / 60,
        activityType: workout.type,
    });
    if (!native) return [];
    return imports.filter((row) => {
        const other = normalizeSession({
            source: row.source,
            startAt: row.startAt,
            durationMin: Number(row.durationSec) / 60,
            activityType: row.activityType,
            averageHr: row.averageHr,
        });
        return other && sameWorkout(native, other);
    });
}

function watchHeartRate(matches) {
    const ranked = matches
        .filter((row) => row.averageHr != null)
        .sort((left, right) => (WATCH_RANK[left.source] ?? 9) - (WATCH_RANK[right.source] ?? 9));
    return ranked[0]?.averageHr ?? null;
}

function mergeProgress(savedRows, incoming, plan) {
    const map = new Map();
    for (const row of savedRows) {
        const index = Number(row.activity_index);
        const planned = plan[index];
        if (!planned) continue;
        map.set(index, {
            activityIndex: index,
            kind: row.kind,
            name: planned.name,
            label: planned.label,
            data: asObject(row.data),
            completedAt: row.completed_at,
        });
    }
    for (const entry of incoming || []) {
        const cleaned = cleanProgress(entry, plan);
        map.set(cleaned.activityIndex, cleaned);
    }
    return [...map.values()].sort((left, right) => left.activityIndex - right.activityIndex);
}

function toSplit(entry) {
    const data = entry.data || {};
    const duration = numberOrNull(data.durationSec);
    const distance = numberOrNull(data.distanceM);
    let pace = numberOrNull(data.avgPaceSecPerKm);
    if (pace == null && duration != null && distance > 0) pace = duration / (distance / 1000);
    const per500 = duration != null && distance > 0 ? duration / (distance / 500) : null;
    const reps = numberOrNull(data.reps);
    let repRate = numberOrNull(data.repRate);
    if (repRate == null && reps != null && duration > 0) repRate = reps / (duration / 60);
    return {
        activityIndex: entry.activityIndex,
        kind: entry.kind,
        name: entry.name,
        label: entry.label,
        durationSec: duration,
        distanceM: distance,
        reps: reps == null ? null : Math.round(reps),
        loadKg: numberOrNull(data.loadKg),
        paceSecPerKm: pace,
        splitSecPer500m: per500,
        repRate,
        avgHr: numberOrNull(data.avgHr),
        inputMethod: data.inputMethod || null,
        data,
    };
}

async function finishLocked(userId, sessionId, body, imports, query) {
    sessionId = await resolveSessionId(query, userId, sessionId);
    const { rows } = await query(
        `
        /* workout:lock_session */
        SELECT id, user_id, workout_id, scheduled_session_id, status, started_at, local_date, result
        FROM workout_sessions
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
        `,
        [sessionId, userId]
    );
    const session = rows[0];
    if (!session) throw httpError('SESSION_NOT_FOUND', 404, { message: 'Session not found' });
    const previous = storedResult(session);
    if (previous && (session.status === 'completed' || session.status === 'partial')) {
        return { replayed: true, payload: previous };
    }
    if (session.status !== 'in_progress') {
        throw httpError('SESSION_NOT_IN_PROGRESS', 400, { message: 'Session is not in progress' });
    }
    const totalDurationSec = Number(body?.totalDurationSec);
    if (!Number.isFinite(totalDurationSec) || totalDurationSec < 0) {
        throw httpError('INVALID_COMPLETE', 400, { message: 'totalDurationSec is required' });
    }

    const workout = workoutOrThrow(session.workout_id);
    const plan = playerActivities(workout);
    const saved = await query(
        `
        /* workout:load_progress */
        SELECT activity_index, kind, data, completed_at
        FROM workout_session_progress
        WHERE session_id = $1
        ORDER BY activity_index
        `,
        [sessionId]
    );
    const merged = mergeProgress(saved.rows, body.completedActivities, plan);
    const splits = merged.map(toSplit);
    const finishedWork = splits.filter((split) => split.kind !== 'roxzone');
    const totalCount = workActivities(plan).length;
    const partial = body.isPartial === true || finishedWork.length < totalCount;
    const roxzoneTotalSec = splits
        .filter((split) => split.kind === 'roxzone')
        .reduce((sum, split) => sum + (Number(split.durationSec) || 0), 0);
    const matches = matchingImports(workout, session, totalDurationSec, imports);
    const heartRate = watchHeartRate(matches) ?? numberOrNull(body.avgHr);
    const evidence = evidenceStatus(finishedWork, heartRate);
    const evidenceDetail = buildEvidence({ status: evidence, splits, matches });
    const sources = ['ROXCLUB_NATIVE', ...matches.map((match) => match.source)];
    const provenance = [
        { source: 'ROXCLUB_NATIVE' },
        ...matches.map((match) => ({ source: match.source, externalId: match.externalId })),
    ];

    const xpRows = await query(
        `/* workout:sum_xp */ SELECT COALESCE(SUM(xp), 0)::int AS xp FROM xp_ledger WHERE user_id = $1`,
        [userId]
    );
    const priorXp = Number(xpRows.rows[0]?.xp) || 0;
    const countRows = await query(
        `
        /* workout:count_today */
        SELECT COUNT(*)::int AS count
        FROM workout_sessions
        WHERE user_id = $1 AND local_date = $2::date
          AND status IN ('completed', 'partial') AND id <> $3
        `,
        [userId, session.local_date, sessionId]
    );
    const priorToday = Number(countRows.rows[0]?.count) || 0;
    const lifetimeRows = await query(
        `
        /* workout:count_completed */
        SELECT COUNT(*)::int AS count
        FROM workout_sessions
        WHERE user_id = $1 AND status IN ('completed', 'partial') AND id <> $2
        `,
        [userId, sessionId]
    );
    const streakRows = await query(
        `
        /* workout:load_streak */
        SELECT current_streak, last_active_on::text AS last_active_on
        FROM user_streaks
        WHERE user_id = $1
        `,
        [userId]
    );
    const badgeRows = await query(
        `/* workout:load_badges */ SELECT kind, code FROM user_rewards WHERE user_id = $1`,
        [userId]
    );
    const planRows = await query(
        `
        /* workout:today_plan */
        SELECT id, workout_id, status, completed_at
        FROM scheduled_sessions
        WHERE user_id = $1 AND scheduled_on = $2::date
        `,
        [userId, session.local_date]
    );

    const xpBreakdown = buildXp({
        workoutType: workout.type,
        partial,
        finishedWork,
        priorSessionsToday: priorToday,
    });
    const totalXp = xpBreakdown.reduce((sum, row) => sum + row.xp, 0);
    const before = levelState(priorXp);
    const after = levelState(priorXp + totalXp);
    const rewardRows = badgeRows.rows;
    const owned = (kind) => rewardRows.filter((row) => row.kind === kind).map((row) => row.code);
    const rewards = [];
    if (after.level > before.level) {
        rewards.push({ type: 'LEVEL_UP', level: after.level, title: `Level ${after.level}`, coins: 0 });
    }
    const lifetime = (Number(lifetimeRows.rows[0]?.count) || 0) + 1;
    rewards.push(...badgeRewards(lifetime, owned('BADGE')));
    rewards.push(...missionRewards(lifetime, owned('MISSION')));
    const sessionCoins = coinsFor(workout.type);
    const previousActiveOn = streakRows.rows[0]?.last_active_on || null;
    const streak = nextStreak(
        streakRows.rows[0]?.current_streak,
        previousActiveOn,
        session.local_date,
        workout.type
    );
    const streakGrew = streak.lastActiveOn === session.local_date && previousActiveOn !== session.local_date;
    if (streakGrew && !owned('STREAK_COINS').includes(`streak_${session.local_date}`)) {
        rewards.push(streakReward(streak.streak, session.local_date));
    }
    const coinsBreakdown = [];
    if (sessionCoins > 0) coinsBreakdown.push({ source: 'session', coins: sessionCoins });
    const coinSource = { STREAK_COINS: 'streak', MISSION: 'mission', BADGE: 'badge' };
    for (const reward of rewards) {
        const source = coinSource[reward.type];
        if (source && reward.coins > 0) coinsBreakdown.push({ source, coins: reward.coins });
    }
    const coinsEarned = coinsBreakdown.reduce((sum, row) => sum + row.coins, 0);
    const activityId = crypto.randomUUID();
    const endedAt = body.endedAt || new Date().toISOString();
    const distanceM = splits.reduce((sum, split) => sum + (Number(split.distanceM) || 0), 0);
    const payload = {
        activityId,
        workoutTitle: workout.title,
        totalTimeSec: totalDurationSec,
        avgHr: heartRate,
        completedCount: finishedWork.length,
        totalCount,
        roxzoneTotalSec,
        splits: splits.map((split) => ({
            index: split.activityIndex,
            name: split.name,
            label: split.label,
            durationSec: split.durationSec,
        })),
        xpBreakdown,
        totalXp,
        coinsEarned,
        coinsBreakdown,
        streak: streak.streak,
        levelBefore: before.level,
        levelAfter: after.level,
        xpIntoLevel: after.xpIntoLevel,
        xpToNextLevel: after.xpToNextLevel,
        evidenceStatus: evidence,
        evidence: evidenceDetail,
        ...(partial ? { subtitle: `${finishedWork.length}/${totalCount} completed` } : {}),
        rewards,
    };

    await query(
        `
        /* workout:insert_activity */
        INSERT INTO activities (
            id, user_id, source, sources, provenance, workout_id, activity_type, name,
            start_at, end_at, duration_sec, distance_m, avg_hr, max_hr, evidence_status,
            roxzone_total_sec, session_id
        )
        VALUES (
            $1, $2, 'ROXCLUB_NATIVE', $3::jsonb, $4::jsonb, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14, $15, $16
        )
        `,
        [
            activityId,
            userId,
            JSON.stringify(sources),
            JSON.stringify(provenance),
            workout.id,
            workout.type,
            workout.title,
            session.started_at,
            endedAt,
            totalDurationSec,
            distanceM,
            heartRate,
            numberOrNull(body.maxHr),
            evidence,
            roxzoneTotalSec,
            sessionId,
        ]
    );

    for (const split of splits) {
        await query(
            `
            /* workout:insert_split */
            INSERT INTO activity_splits (
                id, activity_id, activity_index, kind, name, duration_sec, distance_m, reps, load_kg,
                pace_sec_per_km, split_sec_per_500m, rep_rate, avg_hr, input_method, data
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
            `,
            [
                crypto.randomUUID(),
                activityId,
                split.activityIndex,
                split.kind,
                split.name,
                split.durationSec,
                split.distanceM,
                split.reps,
                split.loadKg,
                split.paceSecPerKm,
                split.splitSecPer500m,
                split.repRate,
                split.avgHr,
                split.inputMethod,
                JSON.stringify(split.data),
            ]
        );
        const points = Array.isArray(split.data.gpsPoints) ? split.data.gpsPoints : [];
        for (let seq = 0; seq < points.length; seq += 1) {
            const point = points[seq];
            await query(
                `
                /* workout:insert_gps */
                INSERT INTO activity_gps_points (activity_id, seq, lat, lng, ts, altitude)
                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [activityId, seq, point.lat, point.lng, point.ts || null, point.altitude]
            );
        }
    }

    for (const row of xpBreakdown) {
        await query(
            `
            /* workout:insert_xp */
            INSERT INTO xp_ledger (user_id, xp, reason, activity_id, calc_version)
            VALUES ($1, $2, $3, $4, $5)
            `,
            [userId, row.xp, row.reason, activityId, xpConfig.calcVersion]
        );
    }
    for (const row of coinsBreakdown) {
        await query(
            `
            /* workout:insert_coins */
            INSERT INTO coins_ledger (user_id, coins, reason, activity_id)
            VALUES ($1, $2, $3, $4)
            `,
            [userId, row.coins, row.source, activityId]
        );
    }
    await query(
        `
        /* workout:upsert_streak */
        INSERT INTO user_streaks (user_id, current_streak, last_active_on)
        VALUES ($1, $2, $3::date)
        ON CONFLICT (user_id) DO UPDATE SET
            current_streak = EXCLUDED.current_streak,
            last_active_on = EXCLUDED.last_active_on,
            updated_at = NOW()
        `,
        [userId, streak.streak, streak.lastActiveOn]
    );
    for (const reward of rewards) {
        const code = reward.type === 'LEVEL_UP' ? `level_${reward.level}` : reward.id;
        await query(
            `
            /* workout:insert_reward */
            INSERT INTO user_rewards (user_id, activity_id, kind, code, payload)
            VALUES ($1, $2, $3, $4, $5::jsonb)
            ON CONFLICT (user_id, kind, code) DO NOTHING
            `,
            [userId, activityId, reward.type, code, JSON.stringify(reward)]
        );
    }

    let linkedId = session.scheduled_session_id || null;
    let planStatus = null;
    if (linkedId) {
        planStatus = partial ? 'partial' : 'done';
    } else {
        const today = planRows.rows[0];
        const open = today && !today.completed_at && (!today.status || today.status === 'pending');
        const planned = open ? getWorkout(today.workout_id) : null;
        if (planned && planned.type === workout.type) {
            linkedId = today.id;
            planStatus = 'replaced';
        }
    }
    if (linkedId && planStatus) {
        await query(
            `
            /* workout:update_scheduled */
            UPDATE scheduled_sessions
            SET status = $3, completed_at = $4
            WHERE id = $1 AND user_id = $2
            `,
            [linkedId, userId, planStatus, endedAt]
        );
    }

    await query(
        `
        /* workout:finish_session */
        UPDATE workout_sessions
        SET status = $3,
            ended_at = $4,
            total_duration_sec = $5,
            paused_duration_sec = $6,
            activity_id = $7,
            local_date = COALESCE(local_date, $8::date),
            result = $9::jsonb,
            scheduled_session_id = COALESCE($10::uuid, scheduled_session_id),
            updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        `,
        [
            sessionId,
            userId,
            partial ? 'partial' : 'completed',
            endedAt,
            totalDurationSec,
            Number(body.pausedDurationSec) || 0,
            activityId,
            session.local_date,
            JSON.stringify(payload),
            linkedId,
        ]
    );
    return { replayed: false, payload, sources, provenance, evidence };
}

async function completeSession(userId, sessionId, body, options = {}) {
    await ready(options);
    const query = options.query;
    const imports = await loadImports(userId, query || dbQuery);
    const run = (runner) => {
        if (query) return runner(query);
        return withTransaction((client) => runner((sql, params) => client.query(sql, params)));
    };
    const result = await run((q) => finishLocked(userId, sessionId, body, imports, q));
    if (!result.replayed) {
        const enqueue = options.enqueueReadinessRecompute || enqueueReadinessRecompute;
        enqueue(userId);
        const queue = options.queueActivityRecorded || queueActivityRecorded;
        const job = queue(result.payload.activityId, query);
        if (query) await job;
    }
    return result.payload;
}

module.exports = {
    startSession,
    getActiveSession,
    saveProgress,
    cancelSession,
    completeSession,
};
