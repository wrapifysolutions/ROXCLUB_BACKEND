const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
    loadWorkoutCatalog,
    getWorkout,
    listWorkouts,
    assertProgramWorkouts,
} = require('../lib/workouts/workoutCatalog');
const { playerActivities, workActivities } = require('../lib/workout/playerPlan');
const {
    startSession,
    saveProgress,
    completeSession,
} = require('../lib/workout/sessionService');
const programs = require('../data/programs.json');
const excelWorkouts = require('../data/excel-workouts.json');
const excelReport = require('../data/excel-import-report.json');
const libraryWorkouts = require('../data/workouts.json');
const programWorkouts = require('../data/program-workouts.json');

loadWorkoutCatalog();

const DAY = '2026-10-28';
const STARTED = '2026-10-28T08:00:00.000Z';

function memoryWorkout() {
    const db = {
        sessions: [],
        progress: [],
        activities: [],
        splits: [],
        gps: [],
        xp: [],
        coins: [],
        streaks: [],
        rewards: [],
        stations: [],
        scheduled: [],
        imports: [],
    };
    db.query = async (sql, params = []) => {
        if (sql.includes('workout:session_by_key')) {
            const row = db.sessions.find((s) => s.user_id === params[0] && s.idempotency_key === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:active_session')) {
            const row = db.sessions
                .filter((s) => s.user_id === params[0] && s.status === 'in_progress')
                .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:scheduled_owner')) {
            const row = db.scheduled.find((s) => s.id === params[0] && s.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:insert_session')) {
            const row = {
                id: params[0],
                user_id: params[1],
                workout_id: params[2],
                scheduled_session_id: params[3],
                status: 'in_progress',
                started_at: params[4],
                idempotency_key: params[5],
                local_date: params[6],
                paused_duration_sec: 0,
                result: null,
                activity_id: null,
            };
            db.sessions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('workout:session_by_workout')) {
            const row = db.sessions
                .filter((s) => s.user_id === params[0] && s.workout_id === params[1] && s.status === 'in_progress')
                .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0];
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:load_session')) {
            const row = db.sessions.find((s) => s.id === params[0] && s.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:upsert_progress')) {
            const existing = db.progress.find(
                (p) => p.session_id === params[1] && Number(p.activity_index) === Number(params[2])
            );
            const row = {
                id: params[0],
                session_id: params[1],
                activity_index: params[2],
                kind: params[3],
                data: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
                completed_at: params[5],
            };
            if (existing) Object.assign(existing, row);
            else db.progress.push(row);
            return { rows: [row] };
        }
        if (sql.includes('workout:save_paused')) {
            const row = db.sessions.find((s) => s.id === params[0] && s.user_id === params[1]);
            if (row) row.paused_duration_sec = params[2];
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:load_progress')) {
            return {
                rows: db.progress
                    .filter((p) => p.session_id === params[0])
                    .sort((a, b) => Number(a.activity_index) - Number(b.activity_index)),
            };
        }
        if (sql.includes('workout:lock_session')) {
            const row = db.sessions.find((s) => s.id === params[0] && s.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:sum_xp')) return { rows: [{ xp: 0 }] };
        if (sql.includes('workout:count_today')) return { rows: [{ count: 0 }] };
        if (sql.includes('workout:count_completed')) return { rows: [{ count: 0 }] };
        if (sql.includes('workout:load_streak')) return { rows: [] };
        if (sql.includes('workout:load_badges')) return { rows: [] };
        if (sql.includes('workout:today_plan')) return { rows: db.scheduled.filter((s) => s.user_id === params[0]) };
        if (sql.includes('workout:insert_activity')) {
            db.activities.push({
                id: params[0],
                user_id: params[1],
                sources: params[2],
                provenance: params[3],
                workout_id: params[4],
                activity_type: params[5],
                name: params[6],
                start_at: params[7],
                end_at: params[8],
                duration_sec: params[9],
                distance_m: params[10],
                avg_hr: params[11],
                max_hr: params[12],
                evidence_status: params[13],
                roxzone_total_sec: params[14],
                session_id: params[15],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_split')) {
            db.splits.push({ activity_id: params[1], activity_index: params[2], kind: params[3], name: params[4] });
            if (params[3] === 'station') db.stations.push({ name: params[4] });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_gps')) {
            db.gps.push({});
            return { rows: [] };
        }
        if (sql.includes('workout:insert_xp')) {
            db.xp.push({ xp: params[1], reason: params[2], activity_id: params[3] });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_coins')) {
            db.coins.push({ coins: params[1], reason: params[2] });
            return { rows: [] };
        }
        if (sql.includes('workout:upsert_streak')) {
            db.streaks = [{ user_id: params[0], current_streak: params[1], last_active_on: params[2] }];
            return { rows: [] };
        }
        if (sql.includes('workout:insert_reward')) {
            db.rewards.push({ kind: params[2], code: params[3] });
            return { rows: [] };
        }
        if (sql.includes('workout:update_scheduled')) {
            const row = db.scheduled.find((s) => s.id === params[0] && s.user_id === params[1]);
            if (row) {
                row.status = params[2];
                row.completed_at = params[3];
            }
            return { rows: [] };
        }
        if (sql.includes('workout:finish_session')) {
            const row = db.sessions.find((s) => s.id === params[0] && s.user_id === params[1]);
            if (row) {
                row.status = params[2];
                row.ended_at = params[3];
                row.total_duration_sec = params[4];
                row.paused_duration_sec = params[5];
                row.activity_id = params[6];
                row.result = typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8];
            }
            return { rows: [] };
        }
        if (sql.includes('FROM imported_activities') || sql.includes('from imported_activities')) {
            return { rows: [] };
        }
        if (sql.includes('strava') || sql.includes('zepp') || sql.includes('apple')) {
            return { rows: [] };
        }
        throw new Error(`unexpected sql: ${sql.slice(0, 120)}`);
    };
    return db;
}

function opts(db) {
    return {
        query: db.query,
        enqueueReadinessRecompute: () => {},
        queueActivityRecorded: async () => {},
        localDate: DAY,
    };
}

function activityEntry(activity, data) {
    return { activityIndex: activity.activityIndex, kind: activity.kind, data };
}

function entriesForPlan(plan) {
    return plan.map((activity) => {
        if (activity.kind === 'run') {
            return activityEntry(activity, {
                durationSec: 300,
                distanceM: activity.target?.distanceM || 1000,
                inputMethod: 'manual',
            });
        }
        if (activity.kind === 'roxzone') {
            return activityEntry(activity, { durationSec: 30, targetSec: 30 });
        }
        if (activity.kind === 'strength_exercise') {
            return activityEntry(activity, { mode: 'simple', durationSec: 120 });
        }
        if (activity.kind === 'recovery_block') {
            return activityEntry(activity, {
                durationSec: activity.target?.durationSec || 60,
            });
        }
        return activityEntry(activity, {
            durationSec: 90,
            inputMethod: 'tap',
            reps: activity.target?.reps || null,
            distanceM: activity.target?.distanceM || null,
            loadKg: activity.target?.loadKg || null,
        });
    });
}

test('excel import report counts match generated catalog', () => {
    assert.equal(excelReport.summary.importedCount, excelWorkouts.length);
    assert.equal(excelWorkouts.length, 86);
    assert.equal(excelReport.summary.unsupportedCount, 55);
    assert.equal(excelReport.summary.excelWorkoutCount, 141);
    assert.deepEqual(excelReport.summary.forceUnsupportedIds, ['HYR-19', 'TRK-13']);
});

test('imported excel workouts do not collide with the original 47 ids', () => {
    const legacy = new Set([...libraryWorkouts, ...programWorkouts].map((w) => w.id));
    assert.equal(legacy.size, 47);
    for (const workout of excelWorkouts) {
        assert.equal(legacy.has(workout.id), false, workout.id);
        assert.match(workout.id, /^(HYR|TRK|STR|ERG|PWR|AER|CON)-\d+$/);
        assert.equal(workout.source, 'excel');
        assert.equal(workout.showInLibrary, true);
    }
});

test('catalog loads every imported excel workout through validateWorkouts', () => {
    const { workouts } = loadWorkoutCatalog({
        workoutsFile: path.join(__dirname, '../data/workouts.json'),
        programWorkoutsFile: path.join(__dirname, '../data/program-workouts.json'),
        excelWorkoutsFile: path.join(__dirname, '../data/excel-workouts.json'),
        categoriesFile: path.join(__dirname, '../data/categories.json'),
        programs: { programs: {} },
    });
    assert.equal(workouts.size, 47 + excelWorkouts.length);
    for (const row of excelWorkouts) {
        const workout = workouts.get(row.id);
        assert.ok(workout, row.id);
        assert.ok(workout.activities.length >= 1);
        assert.equal(workout.activities[0].order, 1);
    }
});

test('warm-ups and unsupported excel workouts are not in the playable catalog', () => {
    for (const row of excelReport.workouts) {
        if (row.status === 'imported') {
            assert.ok(getWorkout(row.id), row.id);
            continue;
        }
        assert.equal(getWorkout(row.id), null, row.id);
        assert.ok((row.reasons || []).length > 0, row.id);
    }
    assert.equal(
        excelReport.workouts.filter((row) => row.category === 'Warm-Ups').every((row) => row.status !== 'imported'),
        true
    );
});

test('existing training program workout ids still resolve', () => {
    assertProgramWorkouts(new Set([...libraryWorkouts, ...programWorkouts, ...excelWorkouts].map((w) => w.id)), programs);
    for (const id of [
        'wk_foundation_a',
        'wk_foundation_b',
        'wk_zone2_run',
        'wk_engine_intervals',
        'wk_simulation',
        'wk_easy_cardio',
        'wk_hybrid_base',
        'wk_hybrid_engine',
        'wk_general_a',
    ]) {
        assert.ok(getWorkout(id), id);
    }
});

test('library listing still includes legacy samples and excel imports, not program-only', () => {
    const page = listWorkouts({ limit: 50 });
    const ids = new Set(page.workouts.map((w) => w.id));
    assert.equal(ids.has('wk_foundation_a'), true);
    assert.equal(ids.has('wk_foundation_b'), false);
    assert.equal(ids.has('HYR-01'), true);
});

test('HYROX autoRoxzone only when run/station alternate', () => {
    const full = getWorkout('HYR-01');
    assert.equal(full.autoRoxzone, true);
    const plan = playerActivities(full);
    assert.ok(plan.some((activity) => activity.kind === 'roxzone'));

    const stationsOnly = excelWorkouts.find(
        (workout) => workout.type === 'hybrid' && workout.autoRoxzone === false && workout.categoryId === 'cat_ergs'
    );
    if (stationsOnly) {
        const loaded = getWorkout(stationsOnly.id);
        assert.equal(loaded.autoRoxzone, false);
        assert.equal(
            playerActivities(loaded).some((activity) => activity.kind === 'roxzone'),
            false
        );
    }
});

test('every imported workout can build a player plan without throwing', () => {
    for (const row of excelWorkouts) {
        const workout = getWorkout(row.id);
        const plan = playerActivities(workout);
        assert.ok(plan.length >= workout.activities.length, row.id);
        for (const activity of plan) {
            assert.equal(typeof activity.activityIndex, 'number');
            assert.ok(['run', 'station', 'roxzone', 'strength_exercise', 'recovery_block'].includes(activity.kind));
        }
    }
});

async function playWorkout(workoutId, key) {
    const db = memoryWorkout();
    const started = await startSession(
        'user-1',
        { workoutId, idempotencyKey: key, startedAt: STARTED },
        opts(db)
    );
    assert.equal(started.workoutId, workoutId);
    const plan = started.activities;
    assert.ok(plan.length > 0);
    const first = plan[0];
    const progressBody = entriesForPlan([first])[0];
    const saved = await saveProgress('user-1', started.sessionId, progressBody, opts(db));
    assert.equal(saved.saved, true);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: '2026-10-28T09:00:00.000Z',
            totalDurationSec: 3600,
            pausedDurationSec: 0,
            completedActivities: entriesForPlan(plan),
        },
        opts(db)
    );
    assert.ok(done.activityId);
    assert.equal(done.workoutTitle, getWorkout(workoutId).title);
    assert.equal(db.activities.length, 1);
    assert.ok(['completed', 'partial'].includes(db.sessions[0].status));
    return { started, done, db };
}

test('every imported workout can start a session', async () => {
    for (const row of excelWorkouts) {
        const db = memoryWorkout();
        const started = await startSession(
            'user-1',
            { workoutId: row.id, idempotencyKey: `start-${row.id}`, startedAt: STARTED },
            opts(db)
        );
        assert.equal(started.workoutId, row.id);
        assert.equal(started.status, 'in_progress');
        assert.ok(started.activities.length >= 1);
    }
});

test('representative imported run/strength/hyrox workouts start progress and complete', async () => {
    const run = excelWorkouts.find((w) => w.type === 'run');
    const strength = excelWorkouts.find((w) => w.type === 'strength');
    assert.ok(run);
    assert.ok(strength);
    await playWorkout(run.id, 'excel-run');
    await playWorkout(strength.id, 'excel-strength');
    await playWorkout('HYR-01', 'excel-hyr-01');
});

test('legacy foundation protocol still works after excel catalog merge', async () => {
    await playWorkout('wk_foundation_a', 'legacy-foundation');
});

test('import report preserves reasons for unsupported instruction-only workouts', () => {
    const sample = excelReport.workouts.find((row) => (row.reasons || []).includes('instruction_only'));
    assert.ok(sample);
    assert.ok(Array.isArray(sample.preservedInstructions));
    assert.ok(sample.preservedInstructions.length > 0);
});

test('excel workout detail exposes preserved load/pace/instructions when present', () => {
    const workout = getWorkout('HYR-01');
    assert.equal(workout.format, 'For Time');
    assert.equal(workout.source, 'excel');
    const sled = workout.activities.find((activity) => activity.movementId === 'SLED_PUSH');
    assert.ok(sled);
    assert.match(sled.loadRule, /division/i);
    assert.ok(sled.notes);
});

test('content-quality exclusions HYR-19 and TRK-13 are not playable or startable', async () => {
    for (const id of ['HYR-19', 'TRK-13']) {
        assert.equal(getWorkout(id), null, id);
        const row = excelReport.workouts.find((item) => item.id === id);
        assert.equal(row.status, 'unsupported');
        assert.ok((row.reasons || []).length > 0);
        const db = memoryWorkout();
        await assert.rejects(
            () =>
                startSession(
                    'user-1',
                    { workoutId: id, idempotencyKey: `blocked-${id}`, startedAt: STARTED },
                    opts(db)
                ),
            (error) => error.code === 'WORKOUT_NOT_FOUND' && error.status === 404
        );
    }
});

test('audit-fixed workouts keep explicit Excel targets without empty work metrics', () => {
    for (const id of ['STR-08', 'STR-10', 'STR-15', 'PWR-08', 'PWR-09', 'PWR-15', 'PWR-16']) {
        const workout = getWorkout(id);
        assert.ok(workout, id);
        for (const activity of workout.activities) {
            const target = activity.target || {};
            assert.equal(
                ['distanceM', 'reps', 'sets', 'durationSec'].some((key) => target[key] != null),
                true,
                `${id}:${activity.order}:${activity.name}`
            );
        }
    }

    const grip = getWorkout('STR-08').activities.find((activity) => activity.movementId === 'DEAD_HANG');
    assert.equal(grip.target.sets, 4);

    const pull = getWorkout('STR-10').activities.find((activity) => activity.movementId === 'PULL_UP');
    assert.equal(pull.target.sets, 4);

    const squat = getWorkout('STR-15').activities.find((activity) => activity.movementId === 'FRONT_SQUAT');
    assert.equal(squat.target.reps, 3);

    const deadlift = getWorkout('PWR-08').activities.find((activity) => activity.movementId === 'DEADLIFT');
    assert.equal(deadlift.target.reps, 3);

    const primer = getWorkout('PWR-09');
    const wallBalls = primer.activities.filter((activity) => activity.movementId === 'WALL_BALL');
    assert.equal(wallBalls.length, 1);
    assert.equal(wallBalls[0].target.sets, 3);
    assert.equal(wallBalls[0].target.reps, 10);

    const swings = getWorkout('PWR-15').activities.filter((activity) => activity.movementId === 'KB_SWING');
    assert.ok(swings.every((activity) => activity.target.reps === 10));

    const throws = getWorkout('PWR-16').activities.filter((activity) => activity.movementId === 'MED_BALL_THROW');
    assert.ok(throws.every((activity) => activity.target.reps === 5));
});

test('no imported workout has an empty work target', () => {
    for (const row of excelWorkouts) {
        const workout = getWorkout(row.id);
        for (const activity of workout.activities) {
            const target = activity.target || {};
            assert.ok(
                ['distanceM', 'reps', 'sets', 'durationSec'].some((key) => target[key] != null),
                `${row.id}:${activity.order}`
            );
        }
    }
});

test('HYR-01 player plan indexes are contiguous for Flutter recovery', () => {
    const plan = playerActivities(getWorkout('HYR-01'));
    assert.equal(plan.length, 31);
    assert.equal(workActivities(plan).length, 16);
    plan.forEach((activity, index) => {
        assert.equal(activity.activityIndex, index);
        assert.equal(activity.index, index);
    });
    assert.equal(plan[0].kind, 'run');
    assert.equal(plan[1].kind, 'roxzone');
    assert.equal(plan[2].kind, 'station');
});
