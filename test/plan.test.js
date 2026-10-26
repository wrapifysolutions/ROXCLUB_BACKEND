const test = require('node:test');
const assert = require('node:assert/strict');
const { buildWeekView, homeStrip } = require('../lib/plan/adaptationService');
const { buildHomeResponse } = require('../lib/home/homeState');
const { getWeekPlan, getHomeWeek, getMissed, getSuggestion, resolveMissed } = require('../lib/plan/planService');
const { planErrorResponse } = require('../controllers/Plan/PlanControllers');
const { runMissedSessionJob } = require('../lib/plan/missedJob');

const TODAY = '2026-10-28';
const WEEK = '2026-10-26';

function memoryPlan() {
    const db = {
        program: { program_id: 'race_build_12w', start_date: '2026-10-05' },
        race: null,
        sessions: [],
        missed: [],
        rewards: [],
        users: [{ id: 'user-1', timezone: 'UTC', onboarding_completed: true }],
    };

    const query = async (sql, params) => {
        if (sql.includes('plan:pending_past')) {
            return {
                rows: db.sessions
                    .filter(
                        (session) =>
                            session.user_id === params[0] &&
                            session.scheduled_on < params[1] &&
                            !session.completed_at &&
                            (!session.status || session.status === 'pending')
                    )
                    .map((session) => ({ id: session.id, scheduled_on: session.scheduled_on })),
            };
        }
        if (sql.includes('plan:insert_missed')) {
            if (!db.missed.some((row) => row.scheduled_session_id === params[2])) {
                db.missed.push({
                    id: params[0],
                    user_id: params[1],
                    scheduled_session_id: params[2],
                    missed_on: params[3],
                    status: 'unresolved',
                    action: null,
                    suggestion: null,
                    created_at: new Date().toISOString(),
                });
            }
            return { rows: [] };
        }
        if (sql.includes('plan:load_program')) return { rows: db.program ? [db.program] : [] };
        if (sql.includes('plan:load_race')) return { rows: db.race ? [db.race] : [] };
        if (sql.includes('plan:load_week')) {
            return {
                rows: db.sessions
                    .filter(
                        (session) =>
                            session.user_id === params[0] &&
                            session.scheduled_on >= params[1] &&
                            session.scheduled_on < params[2]
                    )
                    .map((session) => ({
                        id: session.id,
                        workout_id: session.workout_id,
                        title: session.title,
                        duration_min: session.duration_min,
                        scheduled_on: session.scheduled_on,
                        status: session.status,
                        completed_at: session.completed_at,
                    })),
            };
        }
        if (sql.includes('plan:load_moves')) {
            const rows = db.missed
                .filter((row) => row.user_id === params[0] && row.action === 'apply_suggestion' && row.suggestion)
                .sort((left, right) => String(right.resolved_at || '').localeCompare(String(left.resolved_at || '')));
            return { rows: rows.map((row) => ({ suggestion: row.suggestion })) };
        }
        if (sql.includes('plan:load_rewards')) {
            const ids = new Set(params[1] || []);
            return { rows: db.rewards.filter((row) => ids.has(row.scheduled_session_id)) };
        }
        if (sql.includes('plan:skip_old')) {
            for (const row of db.missed) {
                if (row.user_id === params[0] && row.status === 'unresolved' && row.missed_on < params[1]) {
                    row.status = 'resolved';
                    row.action = 'skipped';
                }
            }
            return { rows: [] };
        }
        if (sql.includes('plan:list_missed') || sql.includes('plan:load_missed')) {
            const rows = db.missed.filter((row) => {
                if (row.user_id !== params[0]) return false;
                if (sql.includes('plan:load_missed')) return row.id === params[1];
                return row.status === 'unresolved';
            });
            rows.sort((left, right) => right.missed_on.localeCompare(left.missed_on) || right.created_at.localeCompare(left.created_at));
            const selected = sql.includes('plan:load_missed') ? rows.slice(0, 1) : rows;
            return {
                rows: selected.map((row) => {
                    const session = db.sessions.find((item) => item.id === row.scheduled_session_id);
                    return {
                        ...row,
                        workout_id: session.workout_id,
                        title: session.title,
                        duration_min: session.duration_min,
                        scheduled_on: session.scheduled_on,
                        plan_status: session.status,
                    };
                }),
            };
        }
        if (sql.includes('plan:move_session')) {
            const session = db.sessions.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (session) {
                session.scheduled_on = params[2];
                session.status = 'pending';
            }
            return { rows: [] };
        }
        if (sql.includes('plan:resolve_missed')) {
            const row = db.missed.find((item) => item.id === params[0] && item.user_id === params[1] && item.status === 'unresolved');
            if (row) {
                row.status = 'resolved';
                row.action = params[2];
                row.suggestion = JSON.parse(params[3]);
                row.resolved_at = new Date().toISOString();
            }
            return { rows: [] };
        }
        if (sql.includes('plan:job_users')) {
            return {
                rows: db.users
                    .filter((user) => user.onboarding_completed)
                    .map((user) => ({ id: user.id, timezone: user.timezone })),
            };
        }
        throw new Error(`unexpected sql: ${sql.trim().slice(0, 80)}`);
    };

    db.query = query;
    return db;
}

function planSession(fields) {
    return {
        user_id: 'user-1',
        status: 'pending',
        completed_at: null,
        duration_min: 45,
        title: 'Workout',
        ...fields,
    };
}

function opts(db) {
    return { query: db.query };
}

test('week view statuses', () => {
    const week = buildWeekView({
        weekStart: WEEK,
        today: TODAY,
        programName: 'Race Build 12 Week',
        weekNumber: 4,
        totalWeeks: 12,
        race: { name: 'HYROX', date: '2026-12-20' },
        sessions: [
            { id: 'done', workoutId: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45, type: 'hybrid', date: '2026-10-26', planStatus: 'done', xpEarned: 40, coinsEarned: 15 },
            { id: 'part', workoutId: 'wk_strength_01', title: 'Lower Base', durationMin: 40, type: 'strength', date: '2026-10-27', planStatus: 'partial' },
            { id: 'today', workoutId: 'wk_zone2_run', title: 'Zone 2 Run', durationMin: 40, type: 'run', date: '2026-10-28', planStatus: 'pending' },
            { id: 'swap', workoutId: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45, type: 'hybrid', date: '2026-10-29', planStatus: 'replaced' },
            { id: 'spin', workoutId: 'wk_recovery_01', title: 'Easy Spin', durationMin: 15, type: 'recovery', date: '2026-10-30', planStatus: 'pending' },
            { id: 'later', workoutId: 'wk_zone2_run', title: 'Zone 2 Run', durationMin: 40, type: 'run', date: '2026-11-01', planStatus: 'pending' },
        ],
    });
    const missed = buildWeekView({
        weekStart: WEEK,
        today: TODAY,
        programName: 'Race Build 12 Week',
        weekNumber: 4,
        totalWeeks: 12,
        sessions: [
            { id: 'old', workoutId: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45, type: 'hybrid', date: '2026-10-26', planStatus: 'pending' },
        ],
    });

    assert.deepEqual(
        week.days.map((day) => day.status),
        ['done', 'partial', 'today', 'replaced', 'recovery', 'rest', 'pending']
    );
    assert.equal(missed.days[0].status, 'missed');
    assert.equal(week.days[2].session.note, 'Zone 2');
    assert.equal(week.days[0].xpEarned, 40);
    assert.equal(week.days[0].coinsEarned, 15);
    assert.equal(week.summary, '5 sessions + 1 recovery');
    assert.equal(week.progressPct, 60);
    assert.equal(week.phase, 'Build');
    assert.equal(week.raceDay.weeksOut > 2, true);
});

test('past pending becomes missed', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({
            id: 'sess-mon',
            workout_id: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            scheduled_on: '2026-10-26',
        })
    );
    await runMissedSessionJob(new Date('2026-10-28T12:00:00Z'), db.query);
    const missed = await getMissed('user-1', TODAY, opts(db));
    const week = await getWeekPlan('user-1', TODAY, WEEK, opts(db));

    assert.equal(db.missed.length, 1);
    assert.equal(missed.count, 1);
    assert.equal(missed.missed[0].scheduledSessionId, 'sess-mon');
    assert.equal(week.days[0].status, 'missed');
});

test('suggestion never puts two hard sessions back to back', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'missed-hard', workout_id: 'wk_foundation_a', title: 'Foundation Protocol A', scheduled_on: '2026-10-26' }),
        planSession({ id: 'today-hard', workout_id: 'wk_strength_01', title: 'Lower Base', duration_min: 40, scheduled_on: '2026-10-27' }),
        planSession({ id: 'thu-hard', workout_id: 'wk_foundation_a', title: 'Foundation Protocol A', scheduled_on: '2026-10-29' })
    );
    const found = await getMissed('user-1', '2026-10-27', opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, '2026-10-27', opts(db));
    const movedTo = suggestion.moves[0].to;

    assert.equal(suggestion.action, 'reschedule');
    assert.equal(movedTo, '2026-10-31');
    assert.notEqual(movedTo, '2026-10-28');
    assert.notEqual(movedTo, '2026-10-30');
    const landed = suggestion.week.days.find((day) => day.date === movedTo);
    const previous = suggestion.week.days.find((day) => day.date === '2026-10-30');
    assert.equal(landed.session.workoutId, 'wk_foundation_a');
    assert.equal(previous.session, null);
});

test('keep_plan leaves sessions unchanged', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', TODAY, opts(db));
    const before = db.sessions[0].scheduled_on;
    const resolved = await resolveMissed('user-1', found.missed[0].id, 'keep_plan', TODAY, opts(db));

    assert.equal(db.sessions[0].scheduled_on, before);
    assert.equal(db.missed[0].status, 'resolved');
    assert.equal(db.missed[0].action, 'keep_plan');
    assert.equal(resolved.applied, false);
    assert.equal((await getMissed('user-1', TODAY, opts(db))).count, 0);
});

test('apply_suggestion moves the session', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', TODAY, opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, TODAY, opts(db));
    await resolveMissed('user-1', found.missed[0].id, 'apply_suggestion', TODAY, {
        ...opts(db),
        planVersion: suggestion.planVersion,
    });

    assert.equal(suggestion.action, 'reschedule');
    assert.equal(db.sessions[0].scheduled_on, suggestion.moves[0].to);
    assert.notEqual(db.sessions[0].scheduled_on, '2026-10-26');
    assert.equal(db.missed.length, 1);
    assert.equal(db.missed[0].status, 'resolved');
    assert.equal(db.missed[0].suggestion.action, 'reschedule');
});

test('race week prefers skip', async () => {
    const db = memoryPlan();
    db.race = { event: 'HYROX', event_date: '2026-11-02' };
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_foundation_a', title: 'Foundation Protocol A', scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', '2026-10-27', opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, '2026-10-27', opts(db));

    assert.equal(suggestion.action, 'skip');
    assert.deepEqual(suggestion.moves, []);
    assert.equal(suggestion.week.raceDay.weeksOut <= 2, true);
});

test('home thisWeek matches plan week', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'done', workout_id: 'wk_foundation_a', title: 'Foundation Protocol A', scheduled_on: '2026-10-26', status: 'done', completed_at: '2026-10-26T10:00:00Z' }),
        planSession({ id: 'today', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: TODAY })
    );
    db.rewards.push({ scheduled_session_id: 'done', xp: 40, coins: 15 });
    const week = await getWeekPlan('user-1', TODAY, WEEK, opts(db));
    const strip = await getHomeWeek('user-1', TODAY, opts(db));
    const home = buildHomeResponse({
        name: 'Alex',
        completedSessions: 3,
        xpTotal: 40,
        thisWeek: strip,
        todaySession: null,
    });

    assert.deepEqual(strip, homeStrip(week));
    assert.deepEqual(
        home.thisWeek.days,
        week.days.map((day) => ({ date: day.date, status: day.status }))
    );
    assert.equal(home.thisWeek.completed, 1);
    assert.equal(home.thisWeek.total, 2);
});

test('suggestion fills the current week before next week', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', '2026-10-28', opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, '2026-10-28', opts(db));

    assert.equal(suggestion.moves[0].to, '2026-10-29');
    assert.equal(suggestion.week.days[0].date, '2026-10-26');
    assert.notEqual(suggestion.moves[0].to, '2026-11-02');
});

test('suggestion spills into next week when this week has no free day left', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', '2026-11-01', opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, '2026-11-01', opts(db));

    assert.equal(suggestion.moves[0].to, '2026-11-02');
    assert.equal(suggestion.week.days[0].date, '2026-11-02');
    const landed = suggestion.week.days.find((day) => day.date === '2026-11-02');
    assert.equal(landed.session.workoutId, 'wk_zone2_run');
});

test('apply_suggestion returns PLAN_CHANGED when the plan moved', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' })
    );
    const found = await getMissed('user-1', TODAY, opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, TODAY, opts(db));
    db.sessions.push(
        planSession({ id: 'extra', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-30' })
    );

    let changed = null;
    try {
        await resolveMissed('user-1', found.missed[0].id, 'apply_suggestion', TODAY, {
            ...opts(db),
            planVersion: suggestion.planVersion,
        });
    } catch (error) {
        changed = error;
    }

    const response = planErrorResponse(changed);
    assert.equal(response.status, 409);
    assert.deepEqual(
        { error: response.body.error, hasSuggestion: Boolean(response.body.suggestion) },
        { error: 'PLAN_CHANGED', hasSuggestion: true }
    );
    assert.notEqual(response.body.suggestion.planVersion, suggestion.planVersion);
    assert.equal(db.sessions[0].scheduled_on, '2026-10-26');

    await resolveMissed('user-1', found.missed[0].id, 'apply_suggestion', TODAY, {
        ...opts(db),
        planVersion: response.body.suggestion.planVersion,
    });
    assert.equal(db.sessions[0].scheduled_on, response.body.suggestion.moves[0].to);
});

test('missed list returns every unresolved session newest first', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' }),
        planSession({ id: 'tue', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-27' }),
        planSession({ id: 'wed', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-28' })
    );
    const missed = await getMissed('user-1', '2026-10-29', opts(db));
    const suggestion = await getSuggestion('user-1', missed.missed[0].id, '2026-10-29', opts(db));

    assert.equal(missed.count, 3);
    assert.deepEqual(
        missed.missed.map((item) => item.date),
        ['2026-10-28', '2026-10-27', '2026-10-26']
    );
    assert.equal(suggestion.moves.length, 2);
    assert.equal(suggestion.skips.length, 1);
    assert.equal(suggestion.week.days[0].date, '2026-10-26');
    const future = suggestion.week.days.filter((day) => day.date > '2026-10-29');
    assert.equal(future.filter((day) => !day.session).length >= 1, true);
    await resolveMissed('user-1', missed.missed[0].id, 'apply_suggestion', '2026-10-29', {
        ...opts(db),
        planVersion: suggestion.planVersion,
    });
    assert.equal(db.missed.filter((row) => row.status === 'resolved').length, 3);
    assert.equal(db.missed.filter((row) => row.action === 'skip').length, 1);
});

test('a missed session from an earlier week is skipped and kept', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'old', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-19' })
    );
    const missed = await getMissed('user-1', '2026-10-28', opts(db));

    assert.equal(missed.count, 0);
    assert.deepEqual(missed.missed, []);
    assert.equal(db.missed.length, 1);
    assert.equal(db.missed[0].status, 'resolved');
    assert.equal(db.missed[0].action, 'skipped');
    assert.equal(db.sessions[0].scheduled_on, '2026-10-19');
});

test('a moved session leaves its original day as moved', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'sess-mon', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' }),
        planSession({ id: 'done', workout_id: 'wk_foundation_a', title: 'Foundation Protocol A', scheduled_on: '2026-10-27', status: 'done', completed_at: '2026-10-27T10:00:00Z' })
    );
    const found = await getMissed('user-1', TODAY, opts(db));
    const suggestion = await getSuggestion('user-1', found.missed[0].id, TODAY, opts(db));
    await resolveMissed('user-1', found.missed[0].id, 'apply_suggestion', TODAY, {
        ...opts(db),
        planVersion: suggestion.planVersion,
    });
    const week = await getWeekPlan('user-1', TODAY, WEEK, opts(db));
    const origin = week.days.find((day) => day.date === '2026-10-26');
    const destination = week.days.find((day) => day.date === suggestion.moves[0].to);

    assert.equal(origin.status, 'moved');
    assert.equal(origin.movedTo, suggestion.moves[0].to);
    assert.equal(origin.session, null);
    assert.equal(destination.session.scheduledSessionId, 'sess-mon');
    assert.equal(week.days.find((day) => day.date === '2026-10-27').status, 'done');

    const finished = buildWeekView({
        weekStart: WEEK,
        today: TODAY,
        programName: 'Race Build 12 Week',
        weekNumber: 4,
        totalWeeks: 12,
        sessions: [
            { id: 'done', workoutId: 'wk_foundation_a', title: 'Foundation Protocol A', durationMin: 45, type: 'hybrid', date: '2026-10-26', planStatus: 'done' },
        ],
        moves: [{ from: '2026-10-26', to: '2026-10-30' }],
    });
    assert.equal(finished.days[0].status, 'done');
    assert.equal(finished.days[0].movedTo, undefined);
});

test('three misses keep a rest day and move only the highest priority', async () => {
    const db = memoryPlan();
    db.sessions.push(
        planSession({ id: 'easy', workout_id: 'wk_zone2_run', title: 'Zone 2 Run', duration_min: 40, scheduled_on: '2026-10-26' }),
        planSession({ id: 'recovery', workout_id: 'wk_recovery_01', title: 'Easy Spin', duration_min: 15, scheduled_on: '2026-10-27' }),
        planSession({ id: 'key', workout_id: 'wk_engine_intervals', title: 'Engine Intervals', duration_min: 45, scheduled_on: '2026-10-28' })
    );
    const missed = await getMissed('user-1', '2026-10-30', opts(db));
    const suggestion = await getSuggestion('user-1', missed.missed[0].id, '2026-10-30', opts(db));
    const future = suggestion.week.days.filter((day) => day.date > '2026-10-30');

    assert.equal(missed.count, 3);
    assert.equal(future.length, 2);
    assert.equal(suggestion.moves.length, 1);
    assert.equal(suggestion.skips.length, 2);
    assert.equal(suggestion.moves[0].scheduledSessionId, 'key');
    assert.equal(future.filter((day) => !day.session).length, 1);
    assert.equal(suggestion.week.days[0].date, '2026-10-26');

    await resolveMissed('user-1', missed.missed[0].id, 'apply_suggestion', '2026-10-30', {
        ...opts(db),
        planVersion: suggestion.planVersion,
    });
    assert.equal(db.sessions.find((session) => session.id === 'key').scheduled_on, suggestion.moves[0].to);
    assert.equal(db.sessions.find((session) => session.id === 'easy').scheduled_on, '2026-10-26');
    assert.equal(db.sessions.find((session) => session.id === 'recovery').scheduled_on, '2026-10-27');
    assert.deepEqual(
        db.missed.filter((row) => row.action === 'skip').map((row) => row.scheduled_session_id).sort(),
        ['easy', 'recovery']
    );
});
