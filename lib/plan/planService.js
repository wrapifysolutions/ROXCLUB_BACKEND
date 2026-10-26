const crypto = require('crypto');
const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const programs = require('../../data/programs.json');
const { getWorkout } = require('../workouts/workoutCatalog');
const {
    addDays,
    mondayOf,
    buildWeekView,
    homeStrip,
    suggestAdjustment,
    previewWeek,
    daysBetween,
} = require('./adaptationService');

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function asObject(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

async function ready(options) {
    if (options.query) return;
    await ensureOnboardingProfileSchema();
}

function daysFrom(weekStart) {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
}

async function markMissedSessions(userId, today, query) {
    const { rows } = await query(
        `
        /* plan:pending_past */
        SELECT id, scheduled_on::text AS scheduled_on
        FROM scheduled_sessions
        WHERE user_id = $1
          AND scheduled_on < $2::date
          AND completed_at IS NULL
          AND (status IS NULL OR status = 'pending')
        `,
        [userId, today]
    );
    for (const row of rows) {
        await query(
            `
            /* plan:insert_missed */
            INSERT INTO missed_sessions (id, user_id, scheduled_session_id, missed_on)
            VALUES ($1, $2, $3, $4::date)
            ON CONFLICT (scheduled_session_id) DO NOTHING
            `,
            [crypto.randomUUID(), userId, row.id, row.scheduled_on]
        );
    }
    await query(
        `
        /* plan:skip_old */
        UPDATE missed_sessions
        SET status = 'resolved', action = 'skipped', resolved_at = NOW()
        WHERE user_id = $1 AND status = 'unresolved' AND missed_on < $2::date
        `,
        [userId, mondayOf(today)]
    );
    return rows.length;
}

function planVersion(sessions) {
    const payload = [...sessions]
        .map((session) => `${session.id}:${session.date}:${session.workoutId}:${session.planStatus || ''}`)
        .sort()
        .join('|');
    return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
}

async function loadContext(userId, query) {
    const programResult = await query(
        `
        /* plan:load_program */
        SELECT program_id, start_date::text AS start_date
        FROM user_programs
        WHERE user_id = $1
        `,
        [userId]
    );
    const raceResult = await query(
        `
        /* plan:load_race */
        SELECT event, event_date::text AS event_date
        FROM race_goals
        WHERE user_id = $1
        `,
        [userId]
    );
    const programRow = programResult.rows[0];
    if (!programRow) throw httpError('PLAN_NOT_FOUND', 404, 'No program is scheduled');
    const catalog = programs.programs[programRow.program_id];
    const raceRow = raceResult.rows[0];
    return {
        programId: programRow.program_id,
        programName: catalog?.name || programRow.program_id,
        startDate: programRow.start_date,
        totalWeeks: catalog?.weeks?.length || 1,
        race: raceRow?.event_date ? { name: raceRow.event, date: raceRow.event_date } : null,
    };
}

async function loadSessions(userId, weekStart, query) {
    const end = addDays(weekStart, 7);
    const { rows } = await query(
        `
        /* plan:load_week */
        SELECT id, workout_id, title, duration_min, scheduled_on::text AS scheduled_on,
               status, completed_at
        FROM scheduled_sessions
        WHERE user_id = $1
          AND scheduled_on >= $2::date
          AND scheduled_on < $3::date
        ORDER BY scheduled_on
        `,
        [userId, weekStart, end]
    );
    const ids = rows.map((row) => row.id);
    let rewards = [];
    if (ids.length) {
        const rewardResult = await query(
            `
            /* plan:load_rewards */
            SELECT ws.scheduled_session_id::text AS scheduled_session_id,
                   COALESCE(SUM(xl.xp), 0)::int AS xp,
                   COALESCE(SUM(cl.coins), 0)::int AS coins
            FROM workout_sessions ws
            LEFT JOIN xp_ledger xl ON xl.activity_id = ws.activity_id
            LEFT JOIN coins_ledger cl ON cl.activity_id = ws.activity_id
            WHERE ws.user_id = $1 AND ws.scheduled_session_id = ANY($2::uuid[])
            GROUP BY ws.scheduled_session_id
            `,
            [userId, ids]
        );
        rewards = rewardResult.rows;
    }
    const rewardById = new Map(rewards.map((row) => [String(row.scheduled_session_id), row]));
    return rows.map((row) => {
        const reward = rewardById.get(String(row.id));
        const linked = reward && (Number(reward.xp) > 0 || Number(reward.coins) > 0 || row.completed_at || row.status);
        return {
            id: row.id,
            workoutId: row.workout_id,
            title: row.title,
            durationMin: Number(row.duration_min) || 0,
            type: getWorkout(row.workout_id)?.type || null,
            date: row.scheduled_on,
            planStatus: row.status || (row.completed_at ? 'done' : 'pending'),
            xpEarned: linked ? Number(reward?.xp) || 0 : null,
            coinsEarned: linked ? Number(reward?.coins) || 0 : null,
        };
    });
}

function weekNumberFor(startDate, weekStart) {
    const days = daysBetween(startDate, weekStart);
    if (days == null || days < 0) return 1;
    return Math.floor(days / 7) + 1;
}

async function getWeekPlan(userId, today, weekStartInput, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    const weekStart = mondayOf(weekStartInput || today);
    await markMissedSessions(userId, today, query);
    const context = await loadContext(userId, query);
    const sessions = await loadSessions(userId, weekStart, query);
    const moves = await loadMoves(userId, weekStart, query);
    return buildWeekView({
        weekStart,
        today,
        programName: context.programName,
        weekNumber: weekNumberFor(context.startDate, weekStart),
        totalWeeks: context.totalWeeks,
        race: context.race,
        sessions,
        moves,
    });
}

async function loadMoves(userId, weekStart, query) {
    const end = addDays(weekStart, 7);
    const { rows } = await query(
        `
        /* plan:load_moves */
        SELECT suggestion
        FROM missed_sessions
        WHERE user_id = $1 AND action = 'apply_suggestion' AND suggestion IS NOT NULL
        ORDER BY resolved_at DESC NULLS LAST, created_at DESC
        `,
        [userId]
    );
    const moves = [];
    const seen = new Set();
    for (const row of rows) {
        const suggestion = asObject(row.suggestion);
        for (const move of suggestion?.moves || []) {
            if (!move?.from || !move?.to || move.from < weekStart || move.from >= end || seen.has(move.from)) continue;
            seen.add(move.from);
            moves.push({ from: move.from, to: move.to, scheduledSessionId: move.scheduledSessionId });
        }
    }
    return moves;
}

async function getHomeWeek(userId, today, options = {}) {
    const week = await getWeekPlan(userId, today, mondayOf(today), options);
    return homeStrip(week);
}

async function listMissed(userId, query) {
    const { rows } = await query(
        `
        /* plan:list_missed */
        SELECT m.id, m.scheduled_session_id, m.missed_on::text AS missed_on, m.status,
               s.workout_id, s.title, s.duration_min, s.scheduled_on::text AS scheduled_on
        FROM missed_sessions m
        JOIN scheduled_sessions s ON s.id = m.scheduled_session_id
        WHERE m.user_id = $1 AND m.status = 'unresolved'
        ORDER BY m.missed_on DESC, m.created_at DESC
        `,
        [userId]
    );
    return rows;
}

function missedDto(row) {
    if (!row) return null;
    return {
        id: row.id,
        scheduledSessionId: row.scheduled_session_id,
        date: row.missed_on,
        workoutId: row.workout_id,
        title: row.title,
        durationMin: Number(row.duration_min) || 0,
    };
}

async function getMissed(userId, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await markMissedSessions(userId, today, query);
    const rows = await listMissed(userId, query);
    return { count: rows.length, missed: rows.map(missedDto) };
}

async function loadMissed(userId, missedId, query) {
    const { rows } = await query(
        `
        /* plan:load_missed */
        SELECT m.id, m.scheduled_session_id, m.missed_on::text AS missed_on, m.status,
               s.workout_id, s.title, s.duration_min, s.scheduled_on::text AS scheduled_on, s.status AS plan_status
        FROM missed_sessions m
        JOIN scheduled_sessions s ON s.id = m.scheduled_session_id
        WHERE m.user_id = $1 AND m.id = $2
        `,
        [userId, missedId]
    );
    if (!rows[0]) throw httpError('MISSED_NOT_FOUND', 404, 'Missed session not found');
    return rows[0];
}

function missedInput(row) {
    return {
        id: row.id,
        scheduledSessionId: row.scheduled_session_id,
        date: row.missed_on,
        workoutId: row.workout_id,
        title: row.title,
        durationMin: Number(row.duration_min) || 0,
        type: getWorkout(row.workout_id)?.type || null,
    };
}

async function buildSuggestion(userId, missedId, today, query) {
    const anchor = missedId ? await loadMissed(userId, missedId, query) : null;
    if (anchor && anchor.status !== 'unresolved') {
        throw httpError('ALREADY_RESOLVED', 409, 'Missed session is already resolved');
    }
    const unresolved = await listMissed(userId, query);
    if (anchor && !unresolved.some((row) => row.id === anchor.id)) {
        throw httpError('ALREADY_RESOLVED', 409, 'Missed session is already resolved');
    }
    if (unresolved.length === 0) throw httpError('MISSED_NOT_FOUND', 404, 'Missed session not found');

    const context = await loadContext(userId, query);
    const weekStart = mondayOf(today);
    const nextStart = addDays(weekStart, 7);
    const sessions = await loadSessions(userId, weekStart, query);
    const nextSessions = await loadSessions(userId, nextStart, query);
    const version = planVersion([...sessions, ...nextSessions]);
    const inputFor = (start, rows) => ({
        weekStart: start,
        today,
        programName: context.programName,
        weekNumber: weekNumberFor(context.startDate, start),
        totalWeeks: context.totalWeeks,
        race: context.race,
        sessions: rows,
    });
    const currentInput = inputFor(weekStart, sessions);
    const nextInput = inputFor(nextStart, nextSessions);
    const current = buildWeekView(currentInput);
    const next = buildWeekView(nextInput);
    const suggestion = suggestAdjustment({
        currentDays: current.days,
        nextDays: next.days,
        missed: unresolved.map(missedInput),
        today,
        race: context.race,
    });
    const previewInput = suggestion.spilled ? nextInput : currentInput;
    const previewSessions = suggestion.spilled ? [...sessions, ...nextSessions] : sessions;
    return {
        missedId: anchor?.id || unresolved[0].id,
        missedIds: unresolved.map((row) => row.id),
        action: suggestion.action,
        reason: suggestion.reason,
        moves: suggestion.moves,
        skips: suggestion.skips || [],
        planVersion: version,
        week: previewWeek({ ...previewInput, sessions: previewSessions }, suggestion),
    };
}

async function getSuggestion(userId, missedId, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    await markMissedSessions(userId, today, query);
    return buildSuggestion(userId, missedId, today, query);
}

async function moveSession(userId, sessionId, date, query) {
    await query(
        `
        /* plan:move_session */
        UPDATE scheduled_sessions
        SET scheduled_on = $3::date, status = 'pending'
        WHERE id = $1 AND user_id = $2
        `,
        [sessionId, userId, date]
    );
}

async function resolveMissed(userId, missedId, action, today, options = {}) {
    await ready(options);
    const query = options.query || queryWithHardTimeout;
    if (action !== 'apply_suggestion' && action !== 'keep_plan') {
        throw httpError('INVALID_ACTION', 400, 'action must be apply_suggestion or keep_plan');
    }
    await markMissedSessions(userId, today, query);
    const suggestion = await buildSuggestion(userId, missedId, today, query);
    if (action === 'apply_suggestion') {
        if (!options.planVersion) {
            throw httpError('PLAN_VERSION_REQUIRED', 400, 'planVersion is required');
        }
        if (options.planVersion !== suggestion.planVersion) {
            const error = httpError('PLAN_CHANGED', 409, 'Plan changed since this suggestion');
            error.suggestion = suggestion;
            throw error;
        }
    }
    if (action === 'apply_suggestion') {
        for (let index = 0; index < suggestion.moves.length; index += 1) {
            const temp = `9999-01-${String(index + 1).padStart(2, '0')}`;
            await moveSession(userId, suggestion.moves[index].scheduledSessionId, temp, query);
        }
        for (const move of suggestion.moves) {
            await moveSession(userId, move.scheduledSessionId, move.to, query);
        }
    }
    const skipIds = new Set((suggestion.skips || []).map((item) => item.missedId));
    for (const id of suggestion.missedIds) {
        const rowAction = action === 'keep_plan' ? 'keep_plan' : skipIds.has(id) ? 'skip' : action;
        await query(
            `
            /* plan:resolve_missed */
            UPDATE missed_sessions
            SET status = 'resolved', action = $3, suggestion = $4::jsonb, resolved_at = NOW()
            WHERE id = $1 AND user_id = $2 AND status = 'unresolved'
            `,
            [id, userId, rowAction, JSON.stringify(suggestion)]
        );
    }
    return {
        missedId,
        action,
        applied: action === 'apply_suggestion',
        week: action === 'apply_suggestion' ? suggestion.week : await getWeekPlan(userId, today, mondayOf(today), { query }),
    };
}

module.exports = {
    markMissedSessions,
    getWeekPlan,
    getHomeWeek,
    getMissed,
    getSuggestion,
    resolveMissed,
    daysFrom,
};
