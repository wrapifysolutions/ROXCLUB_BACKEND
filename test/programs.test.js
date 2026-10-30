const test = require('node:test');
const assert = require('node:assert/strict');
const programs = require('../data/programs.json');
const publicPrograms = require('../data/public-programs.json');
const programMatch = require('../config/program-match.json');
const { phaseFor } = require('../lib/plan/adaptationService');
const { loadWorkoutCatalog, assertProgramWorkouts } = require('../lib/workouts/workoutCatalog');
const {
    listPublicDefinitions,
    getPublicDefinition,
    contentStatus,
    internalProgramIds,
    phasesFor,
} = require('../lib/programs/publicCatalog');
const {
    listPrograms,
    getProgram,
    getMyProgram,
    enrollProgram,
    progressFromSessions,
} = require('../lib/programs/programService');
const { resolveProgram } = require('../lib/onboarding/programCatalog');
const { buildWeekView } = require('../lib/plan/adaptationService');

loadWorkoutCatalog();

const TODAY = '2026-10-28';

function memoryPrograms() {
    const db = {
        enrollment: null,
        sessions: [],
        missed: [],
        users: [{ id: 'user-1' }],
    };

    const query = async (sql, params) => {
        if (sql.includes('programs:load_enrollment') || sql.includes('programs:existing_enrollment')) {
            return { rows: db.enrollment ? [db.enrollment] : [] };
        }
        if (sql.includes('programs:lock_user')) {
            return { rows: db.users.filter((user) => user.id === params[0]) };
        }
        if (sql.includes('programs:insert_enrollment')) {
            if (db.enrollment) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            db.enrollment = {
                program_id: params[1],
                start_date: params[2],
            };
            return { rows: [] };
        }
        if (sql.includes('programs:insert_sessions')) {
            const payload = JSON.parse(params[1]);
            for (const session of payload) {
                if (db.sessions.some((row) => row.user_id === params[0] && row.scheduled_on === session.scheduled_on)) {
                    continue;
                }
                db.sessions.push({
                    id: `sess-${db.sessions.length + 1}`,
                    user_id: params[0],
                    program_id: session.program_id,
                    workout_id: session.workout_id,
                    title: session.title,
                    duration_min: session.duration_min,
                    scheduled_on: session.scheduled_on,
                    plan_day: session.plan_day,
                    week_number: session.week_number,
                    status: 'pending',
                    completed_at: null,
                });
            }
            return { rows: [] };
        }
        if (sql.includes('programs:session_stats')) {
            return {
                rows: db.sessions
                    .filter((session) => session.user_id === params[0])
                    .map((session) => {
                        const missed = db.missed.find((row) => row.scheduled_session_id === session.id);
                        return {
                            id: session.id,
                            workout_id: session.workout_id,
                            scheduled_on: session.scheduled_on,
                            status: session.status,
                            completed_at: session.completed_at,
                            is_missed_unresolved: Boolean(missed && missed.status === 'unresolved'),
                            is_skipped: Boolean(missed && missed.action === 'skipped'),
                        };
                    }),
            };
        }
        throw new Error(`Unhandled SQL in programs test: ${sql.split('\n')[1] || sql}`);
    };

    return { db, query, opts: { query } };
}

test('four public programs are returned with approved durations', async () => {
    const { opts } = memoryPrograms();
    const payload = await listPrograms('user-1', TODAY, opts);
    assert.equal(payload.programs.length, 4);
    assert.deepEqual(
        payload.programs.map((item) => [item.id, item.durationWeeks, item.name]),
        [
            ['race_build_12w', 12, 'Race Build — 12 Weeks'],
            ['rox_engine_8w', 8, 'ROX Engine — 8 Weeks'],
            ['strength_hybrid_6w', 6, 'Strength for Hybrid — 6 Weeks'],
            ['off_season_base_6w', 6, 'Off-Season Base — 6 Weeks'],
        ]
    );
});

test('internal nine programs remain intact and unchanged by public catalog', () => {
    const internal = internalProgramIds().sort();
    assert.deepEqual(internal, [
        'general_build_8w',
        'general_perform_8w',
        'general_start_8w',
        'hybrid_base_8w',
        'hybrid_engine_12w',
        'hybrid_race_8w',
        'hyrox_base_8w',
        'hyrox_peak_8w',
        'race_build_12w',
    ]);
    assertProgramWorkouts(
        new Map(Object.keys(programs.workouts).map((id) => [id, true])),
        programs
    );
    for (const rule of programMatch.rules) {
        assert.ok(programs.programs[rule.programId], `match rule program ${rule.programId}`);
    }
    assert.equal(resolveProgram('hyrox', 'Intermediate').id, 'race_build_12w');
    assert.equal(resolveProgram('hyrox', 'Beginner').id, 'hyrox_base_8w');
});

test('Race Build phase boundaries are Base/Build/Peak/Taper', () => {
    const expected = {
        1: 'Base',
        4: 'Base',
        5: 'Build',
        9: 'Build',
        10: 'Peak',
        11: 'Peak',
        12: 'Taper',
    };
    for (const [week, phase] of Object.entries(expected)) {
        assert.equal(phaseFor(Number(week), 12, 'race_build_12w'), phase);
    }
    assert.equal(phaseFor(12, 12), 'Race');
    assert.equal(phaseFor(4, 12), 'Build');
    assert.deepEqual(
        phasesFor('race_build_12w').map((phase) => [phase.name, phase.weeksFrom, phase.weeksTo]),
        [
            ['Base', 1, 4],
            ['Build', 5, 9],
            ['Peak', 10, 11],
            ['Taper', 12, 12],
        ]
    );
});

test('Race Build public card targets 3 workouts/week and is not enrollable', async () => {
    const { opts } = memoryPrograms();
    const payload = await listPrograms('user-1', TODAY, opts);
    const byId = Object.fromEntries(payload.programs.map((item) => [item.id, item]));
    assert.equal(byId.race_build_12w.workoutFrequency.workoutsPerWeek, 3);
    assert.equal(byId.race_build_12w.workoutFrequency.source, 'product_target');
    assert.equal(byId.race_build_12w.intendedFrequency.workoutsPerWeek, 3);
    assert.equal(byId.race_build_12w.intendedFrequency.targetTrainingSessions, 36);
    assert.equal(byId.race_build_12w.contentReadiness, 'awaiting_coach_schedule');
    assert.equal(byId.race_build_12w.enrollable, false);
    assert.equal(byId.race_build_12w.canEnroll, false);
    assert.equal(byId.race_build_12w.enrollmentBlockedReason, 'missing_approved_schedule');
    for (const id of ['rox_engine_8w', 'strength_hybrid_6w', 'off_season_base_6w']) {
        assert.equal(byId[id].enrollable, false);
        assert.equal(byId[id].canEnroll, false);
        assert.equal(byId[id].contentReadiness, 'awaiting_coach_schedule');
        assert.equal(byId[id].enrollmentBlockedReason, 'missing_approved_schedule');
    }
    assert.equal(contentStatus(getPublicDefinition('race_build_12w')).enrollable, false);
});

test('program detail keeps Race Build phases without exposing unapproved week preview', async () => {
    const { opts } = memoryPrograms();
    const race = await getProgram('user-1', 'race_build_12w', opts);
    assert.equal(race.scheduleAvailable, false);
    assert.equal(race.weekPreview, null);
    assert.equal(race.phases[3].name, 'Taper');
    assert.equal(race.legacySchedule.exists, true);
    assert.equal(race.legacySchedule.approved, false);
    assert.equal(race.legacySchedule.totalScheduledSessions, 72);
    assert.equal(race.legacySchedule.workoutsPerWeek, 6);
    assert.equal(race.workoutFrequency.workoutsPerWeek, 3);

    const engine = await getProgram('user-1', 'rox_engine_8w', opts);
    assert.equal(engine.scheduleAvailable, false);
    assert.equal(engine.weekPreview, null);
    assert.equal(engine.enrollable, false);
});

test('empty Active tab when user has no enrollment', async () => {
    const { opts } = memoryPrograms();
    const me = await getMyProgram('user-1', TODAY, opts);
    assert.equal(me.enrollment, null);
    assert.ok(me.emptyState);
});

test('public Race Build enrollment is blocked and creates no records', async () => {
    const { db, opts } = memoryPrograms();
    await assert.rejects(
        () => enrollProgram('user-1', 'race_build_12w', TODAY, opts),
        (error) => error.code === 'PROGRAM_NOT_ENROLLABLE'
    );
    assert.equal(db.enrollment, null);
    assert.equal(db.sessions.length, 0);
});

test('enrollment blocked for programs without approved schedules', async () => {
    const { opts } = memoryPrograms();
    await assert.rejects(
        () => enrollProgram('user-1', 'rox_engine_8w', TODAY, opts),
        (error) => error.code === 'PROGRAM_NOT_ENROLLABLE'
    );
});

test('canEnroll stays false for Race Build even with no active program', async () => {
    const { opts } = memoryPrograms();
    const payload = await listPrograms('user-1', TODAY, opts);
    const race = payload.programs.find((item) => item.id === 'race_build_12w');
    assert.equal(race.enrollable, false);
    assert.equal(race.canEnroll, false);
    assert.equal(race.enrollmentBlockedReason, 'missing_approved_schedule');
});

test('no fabricated 36-session Race Build schedule exists in catalogs', () => {
    assert.equal(programs.programs.race_build_12w.weeks.length, 12);
    const total = programs.programs.race_build_12w.weeks.reduce(
        (sum, week) => sum + week.days.length,
        0
    );
    assert.equal(total, 72);
    assert.notEqual(total, 36);
    assert.equal(getPublicDefinition('race_build_12w').scheduleProgramId, null);
    assert.equal(getPublicDefinition('race_build_12w').intendedTrainingSessions, 36);
});

test('onboarding enrollments remain visible on /me with correct phase', async () => {
    const { db, opts } = memoryPrograms();
    db.enrollment = { program_id: 'race_build_12w', start_date: '2026-10-05' };
    db.sessions = [
        {
            id: 'a',
            user_id: 'user-1',
            workout_id: 'wk_foundation_a',
            scheduled_on: '2026-10-05',
            status: 'done',
            completed_at: '2026-10-05T10:00:00Z',
        },
        {
            id: 'b',
            user_id: 'user-1',
            workout_id: 'wk_zone2_run',
            scheduled_on: '2026-10-06',
            status: 'pending',
            completed_at: null,
        },
        {
            id: 'c',
            user_id: 'user-1',
            workout_id: 'wk_engine_intervals',
            scheduled_on: '2026-10-20',
            status: 'pending',
            completed_at: null,
        },
    ];
    db.missed = [{ scheduled_session_id: 'b', status: 'unresolved', action: null }];

    const me = await getMyProgram('user-1', TODAY, opts);
    assert.equal(me.enrollment.programId, 'race_build_12w');
    assert.equal(me.enrollment.programName, 'Race Build — 12 Weeks');
    assert.equal(me.enrollment.currentWeek, 4);
    assert.equal(me.enrollment.phase, 'Base');
    assert.equal(me.enrollment.progress.completedSessions, 1);
    assert.equal(me.enrollment.progress.missedSessions, 2);
    assert.equal(me.enrollment.progress.totalScheduledSessions, 3);
    assert.equal(me.enrollment.continue.weekNumber, 4);
    assert.match(me.enrollment.continue.planPath, /weekStart=2026-10-26/);
    assert.equal(me.enrollment.scheduleProvenance, 'legacy_unapproved');
    assert.equal(me.enrollment.approvedProductFrequency.workoutsPerWeek, 3);
});

test('overall progress does not count skipped as completed', () => {
    const progress = progressFromSessions(
        [
            {
                workout_id: 'wk_foundation_a',
                scheduled_on: '2026-10-05',
                status: 'done',
                is_missed_unresolved: false,
                is_skipped: false,
            },
            {
                workout_id: 'wk_zone2_run',
                scheduled_on: '2026-10-06',
                status: 'pending',
                is_missed_unresolved: false,
                is_skipped: true,
            },
            {
                workout_id: 'wk_simulation',
                scheduled_on: '2026-10-07',
                status: 'pending',
                is_missed_unresolved: false,
                is_skipped: false,
            },
        ],
        {
            startDate: '2026-10-05',
            today: TODAY,
            programId: 'race_build_12w',
            totalWeeks: 12,
        }
    );
    assert.equal(progress.completedSessions, 1);
    assert.equal(progress.skippedSessions, 1);
    assert.equal(progress.progressPct, 33);
});

test('public catalog does not invent descriptions or difficulties', () => {
    for (const definition of listPublicDefinitions()) {
        assert.equal(definition.description, null);
        assert.equal(definition.difficulty, null);
        assert.equal(definition.goals, null);
    }
    assert.equal(publicPrograms.programs.length, 4);
});

test('unknown public program returns not found', async () => {
    const { opts } = memoryPrograms();
    await assert.rejects(
        () => getProgram('user-1', 'hyrox_base_8w', opts),
        (error) => error.code === 'PROGRAM_NOT_FOUND'
    );
});

test('weekly plan uses Race Build Taper on week 12 and keeps percent phases without programId', () => {
    const taper = buildWeekView({
        weekStart: '2026-12-21',
        today: '2026-12-21',
        programName: 'Race Build 12 Week',
        programId: 'race_build_12w',
        weekNumber: 12,
        totalWeeks: 12,
        sessions: [],
        moves: [],
    });
    assert.equal(taper.phase, 'Taper');

    const legacy = buildWeekView({
        weekStart: '2026-12-21',
        today: '2026-12-21',
        programName: 'HYROX Peak 8 Week',
        programId: 'hyrox_peak_8w',
        weekNumber: 8,
        totalWeeks: 8,
        sessions: [],
        moves: [],
    });
    assert.equal(legacy.phase, 'Race');
});
