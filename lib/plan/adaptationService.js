const planConfig = require('../../config/plan.json');
const { getWorkout } = require('../workouts/workoutCatalog');
const { phaseNameFor } = require('../programs/publicCatalog');

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DONE = new Set(['done', 'partial', 'replaced']);

function addDays(iso, days) {
    const date = new Date(`${iso}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function mondayOf(iso) {
    const date = new Date(`${iso}T00:00:00Z`);
    const day = date.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    date.setUTCDate(date.getUTCDate() - diff);
    return date.toISOString().slice(0, 10);
}

function dayLabel(iso) {
    return DAY_LABELS[new Date(`${iso}T00:00:00Z`).getUTCDay()];
}

function daysBetween(start, end) {
    const from = Date.parse(`${start}T00:00:00Z`);
    const to = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    return Math.round((to - from) / 86400000);
}

function weeksOut(today, raceDate) {
    const days = daysBetween(today, raceDate);
    if (days == null || days < 0) return null;
    return Math.ceil(days / 7);
}

function phaseFor(weekNumber, totalWeeks, programId) {
    const explicit = programId ? phaseNameFor(programId, weekNumber, totalWeeks) : null;
    if (explicit) return explicit;
    const total = Math.max(1, Number(totalWeeks) || 1);
    const pct = Number(weekNumber) / total;
    const phases = planConfig.phases || [];
    const match = phases.find((phase) => pct <= Number(phase.untilPct));
    return match?.name || phases[phases.length - 1]?.name || 'Build';
}

function workoutType(workoutId) {
    return getWorkout(workoutId)?.type || null;
}

function sessionNote(workoutId, title) {
    if (planConfig.notes?.[workoutId]) return planConfig.notes[workoutId];
    const text = String(title || '');
    if (/zone\s*2/i.test(text)) return 'Zone 2';
    if (/interval|threshold/i.test(text)) return 'threshold';
    return null;
}

function isHard(session) {
    if (!session) return false;
    if (session.type === 'recovery') return false;
    if ((planConfig.easyWorkoutIds || []).includes(session.workoutId)) return false;
    if ((planConfig.hardWorkoutIds || []).includes(session.workoutId)) return true;
    return (planConfig.hardTypes || []).includes(session.type);
}

function priorityKey(session) {
    const groups = planConfig.priorityGroups || {};
    const ranked = ['key', 'threshold', 'long'];
    const match = ranked.find((name) => (groups[name] || []).includes(session?.workoutId));
    if (match) return match;
    if (session?.type === 'recovery') return 'recovery';
    if ((planConfig.easyWorkoutIds || []).includes(session?.workoutId)) return 'easy';
    if (session?.type && planConfig.priority?.[session.type] != null) return session.type;
    return 'easy';
}

function priorityOf(session) {
    const table = planConfig.priority || {};
    return Number(table[priorityKey(session)] ?? 0);
}

function dayStatus(date, today, session, movedTo) {
    if (session && DONE.has(session.planStatus)) return session.planStatus;
    if (movedTo) return 'moved';
    if (!session) return 'rest';
    if (date < today) return 'missed';
    if (session.type === 'recovery') return 'recovery';
    if (date === today) return 'today';
    return 'pending';
}

function decorateSession(session) {
    if (!session) return null;
    const type = session.type || workoutType(session.workoutId);
    return {
        ...session,
        type,
        note: session.note === undefined ? sessionNote(session.workoutId, session.title) : session.note,
    };
}

function movedToByDate(moves) {
    const map = new Map();
    for (const move of moves || []) {
        if (!move?.from || !move?.to || map.has(move.from)) continue;
        map.set(move.from, move.to);
    }
    return map;
}

function buildWeekDays(weekStart, today, sessions, moves) {
    const byDate = new Map();
    for (const session of sessions) {
        byDate.set(session.date, decorateSession(session));
    }
    const moved = movedToByDate(moves);
    const days = [];
    for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(weekStart, offset);
        const session = byDate.get(date) || null;
        const movedTo = moved.get(date) || null;
        const status = dayStatus(date, today, session, movedTo);
        const day = {
            date,
            dayLabel: dayLabel(date),
            status,
            session: session
                ? {
                      scheduledSessionId: session.id,
                      workoutId: session.workoutId,
                      title: session.title,
                      durationMin: Number(session.durationMin) || 0,
                      type: session.type,
                      note: session.note,
                  }
                : null,
        };
        if (status === 'moved') day.movedTo = movedTo;
        if (session && (session.xpEarned != null || session.coinsEarned != null)) {
            if (session.xpEarned != null) day.xpEarned = Number(session.xpEarned);
            if (session.coinsEarned != null) day.coinsEarned = Number(session.coinsEarned);
        }
        days.push(day);
    }
    return days;
}

function progressOf(days) {
    const countable = days.filter((day) => day.session && day.session.type !== 'recovery');
    const completed = countable.filter((day) => DONE.has(day.status)).length;
    const total = countable.length;
    return {
        completed,
        total,
        progressPct: total === 0 ? 0 : Math.round((completed / total) * 100),
    };
}

function summaryOf(days) {
    const recovery = days.filter((day) => day.session?.type === 'recovery').length;
    const sessions = days.filter((day) => day.session && day.session.type !== 'recovery').length;
    const sessionLabel = `${sessions} session${sessions === 1 ? '' : 's'}`;
    if (recovery === 0) return sessionLabel;
    return `${sessionLabel} + ${recovery} recovery`;
}

function buildWeekView({
    weekStart,
    today,
    programName,
    programId,
    weekNumber,
    totalWeeks,
    race,
    sessions,
    moves,
}) {
    const days = buildWeekDays(weekStart, today, sessions, moves);
    const progress = progressOf(days);
    const raceWeeks = race?.date ? weeksOut(today, race.date) : null;
    return {
        programName: programName || null,
        programId: programId || null,
        phase: phaseFor(weekNumber, totalWeeks, programId),
        weekNumber,
        totalWeeks,
        progressPct: progress.progressPct,
        summary: summaryOf(days),
        days,
        raceDay: race?.date
            ? { name: race.name, date: race.date, weeksOut: raceWeeks }
            : null,
    };
}

function homeStrip(week) {
    const progress = progressOf(week.days);
    return {
        completed: progress.completed,
        total: progress.total,
        days: week.days.map((day) => ({ date: day.date, status: day.status })),
    };
}

function insideRaceBuffer(date, raceDate) {
    if (!raceDate) return false;
    const buffer = Number(planConfig.raceBufferDays ?? 2);
    return date >= addDays(raceDate, -buffer);
}

function hardNeighbor(days, date, sessionId) {
    const around = new Set([addDays(date, -1), addDays(date, 1)]);
    return days.some((day) => around.has(day.date) && day.session && day.session.scheduledSessionId !== sessionId && isHard(day.session));
}

function restDays(days, today) {
    return days.filter((day) => day.date > today && !day.session);
}

function applyMoves(sessions, moves) {
    const next = sessions.map((session) => ({ ...session }));
    for (const move of moves) {
        const session = next.find((item) => item.id === move.scheduledSessionId);
        if (session) session.date = move.to;
    }
    return next;
}

function cloneDays(days) {
    return (days || []).map((day) => ({
        ...day,
        session: day.session ? { ...day.session } : null,
    }));
}

function placeOnBoard(boards, move, session) {
    for (const days of boards) {
        const source = days.find((day) => day.date === move.from);
        if (source?.session?.scheduledSessionId === session.scheduledSessionId) {
            source.session = null;
            source.status = 'rest';
        }
        const target = days.find((day) => day.date === move.to);
        if (!target) continue;
        target.session = {
            scheduledSessionId: session.scheduledSessionId,
            workoutId: session.workoutId,
            title: session.title,
            type: session.type,
            durationMin: session.durationMin,
        };
        target.status = 'pending';
    }
}

function firstLegalDay(days, session, today, race, board) {
    const open = restDays(days, today)
        .filter((day) => !insideRaceBuffer(day.date, race?.date))
        .filter((day) => !isHard(session) || !hardNeighbor(board, day.date, session.scheduledSessionId))
        .sort((left, right) => (left.date < right.date ? -1 : 1));
    return open[0] || null;
}

function skipEntry(item) {
    return {
        missedId: item.id,
        scheduledSessionId: item.scheduledSessionId,
        from: item.date,
    };
}

function weekDecision(days, placed, session, today, race, board) {
    const max = Number(planConfig.maxRescheduledPerWeek ?? 2);
    const minRest = Number(planConfig.minRestDaysPerWeek ?? 1);
    const open = restDays(days, today);
    if (placed >= max || (open.length <= minRest && placed > 0)) return { status: 'full' };
    if (open.length <= minRest) return { status: 'elsewhere' };
    const day = firstLegalDay(days, session, today, race, board);
    if (!day) return { status: 'elsewhere' };
    return { status: 'ok', day };
}

function suggestionResult(moves, skips, missedList, next) {
    const missedIds = missedList.map((item) => item.id).filter(Boolean);
    const nextWeekStart = next[0]?.date || null;
    const spilled = Boolean(nextWeekStart && moves.some((move) => move.to >= nextWeekStart));
    if (moves.length === 0) {
        return {
            action: 'skip',
            reason: 'No open day keeps a rest day and hard sessions apart',
            moves,
            skips,
            spilled: false,
            missedIds,
        };
    }
    let reason = 'Move to the next free day this week';
    if (skips.length) reason = 'Move the highest-priority sessions that fit and skip the rest';
    else if (spilled) reason = 'Current week is full, so the session moves to next week';
    return { action: 'reschedule', reason, moves, skips, spilled, missedIds };
}

function suggestAdjustment({ currentDays, nextDays, days, missed, today, race }) {
    const crunch = Number(planConfig.raceCrunchWeeks ?? 2);
    const out = race?.date ? weeksOut(today, race.date) : null;
    const missedList = (Array.isArray(missed) ? missed : missed ? [missed] : [])
        .map((item) => ({
            ...item,
            scheduledSessionId: item.scheduledSessionId,
            type: item.type || workoutType(item.workoutId),
        }))
        .sort((left, right) => priorityOf(right) - priorityOf(left) || (left.date < right.date ? -1 : 1));
    if (out != null && out <= crunch) {
        return {
            action: 'skip',
            reason: 'Near the race, missed volume is skipped',
            moves: [],
            skips: missedList.map(skipEntry),
            missedIds: missedList.map((item) => item.id).filter(Boolean),
        };
    }

    const current = cloneDays(currentDays || days);
    const next = cloneDays(nextDays);
    const boards = [current, next];
    const moves = [];
    const skips = [];
    let currentPlaced = 0;
    let nextPlaced = 0;
    for (const item of missedList) {
        const session = {
            scheduledSessionId: item.scheduledSessionId,
            workoutId: item.workoutId,
            title: item.title,
            type: item.type,
            durationMin: item.durationMin,
        };
        const board = [...current, ...next];
        const here = weekDecision(current, currentPlaced, session, today, race, board);
        let chosen = null;
        let bucket = null;
        if (here.status === 'ok') {
            chosen = here.day;
            bucket = 'current';
        } else if (here.status === 'elsewhere') {
            const there = weekDecision(next, nextPlaced, session, today, race, board);
            if (there.status === 'ok') {
                chosen = there.day;
                bucket = 'next';
            }
        }
        if (!chosen) {
            skips.push(skipEntry(item));
            continue;
        }
        const move = { scheduledSessionId: item.scheduledSessionId, from: item.date, to: chosen.date };
        moves.push(move);
        placeOnBoard(boards, move, session);
        if (bucket === 'current') currentPlaced += 1;
        else nextPlaced += 1;
    }

    return suggestionResult(moves, skips, missedList, next);
}

function previewWeek(input, suggestion) {
    const sessions = applyMoves(input.sessions, suggestion.moves || []);
    return buildWeekView({ ...input, sessions, moves: suggestion.moves || [] });
}

module.exports = {
    addDays,
    mondayOf,
    daysBetween,
    weeksOut,
    phaseFor,
    isHard,
    dayStatus,
    buildWeekView,
    homeStrip,
    suggestAdjustment,
    previewWeek,
    applyMoves,
};
