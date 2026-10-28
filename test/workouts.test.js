const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ASSET_BASE_URL = 'https://assets.roxclub.app';

const { loadWorkoutCatalog, listWorkouts, listCategories, getWorkout } = require('../lib/workouts/workoutCatalog');
const { validateWorkouts } = require('../lib/workouts/validateWorkouts');
const {
    getWorkoutDetail,
    saveWorkout,
    listCategoryWorkouts,
    listWorkouts: listWorkoutPage,
} = require('../lib/workouts/workoutService');
const { continueFrom, readinessHint } = require('../lib/workouts/trainOverview');
const { startSession } = require('../lib/workout/sessionService');

loadWorkoutCatalog();

function memoryQuery() {
    const rows = [];
    const query = async (sql, params = []) => {
        if (sql.includes('CREATE TABLE')) return { rows: [] };
        if (sql.includes('INSERT INTO saved_workouts')) {
            const key = `${params[0]}:${params[1]}`;
            if (!rows.some((row) => row.key === key)) {
                rows.push({ key, user_id: params[0], workout_id: params[1] });
            }
            return { rows: [] };
        }
        if (sql.includes('SELECT workout_id')) {
            const ids = params[1] || [];
            return {
                rows: rows
                    .filter((row) => row.user_id === params[0] && ids.includes(row.workout_id))
                    .map((row) => ({ workout_id: row.workout_id })),
            };
        }
        if (sql.includes('SELECT 1')) {
            const found = rows.some(
                (row) => row.user_id === params[0] && row.workout_id === params[1]
            );
            return { rows: found ? [1] : [] };
        }
        throw new Error(`unexpected sql: ${sql}`);
    };
    return { rows, query };
}

test('Foundation Protocol A returns 8 activities in order with targets', async () => {
    const detail = await getWorkoutDetail('user-1', 'wk_foundation_a', memoryQuery().query);

    assert.equal(detail.activityCount, 8);
    assert.equal(detail.activityCount, detail.activities.length);
    assert.deepEqual(
        detail.activities.map((activity) => activity.name),
        [
            'Running',
            'Wall Balls',
            'Sandbag Lunges',
            'Burpee Broad Jump',
            'Sled Push',
            'Row',
            'SkiErg',
            'Farmers Carry',
        ]
    );
    assert.deepEqual(
        detail.activities.map((activity) => activity.order),
        [1, 2, 3, 4, 5, 6, 7, 8]
    );
    assert.deepEqual(detail.activities[0].target, { distanceM: 1000 });
    assert.deepEqual(detail.activities[4].target, { distanceM: 20, loadKg: 102 });
    assert.equal(detail.activities[4].label, '20 m (102 kg)');
    assert.deepEqual(detail.activities[7].target, { distanceM: 20, loadKg: 32 });
    assert.equal(detail.categoryId, 'cat_hybrid_race');
    assert.equal(detail.categoryName, 'Hybrid Race');
    assert.equal(detail.author, 'ROX CLUB');
    assert.equal(detail.imageKey, 'wk_foundation_a');
    assert.equal(detail.imageUrl, null);
    assert.equal(detail.activities[0].iconKey, 'run');
    assert.equal(detail.activities[4].iconKey, 'sled');
    assert.equal(detail.isSaved, false);
});

test('opening Recovery returns every workout with full activity detail', async () => {
    const db = memoryQuery();
    await saveWorkout('user-1', 'wk_recovery_02', db.query);
    const result = await listCategoryWorkouts('user-1', 'recovery', db.query);

    assert.equal(result.category.id, 'cat_recovery');
    assert.equal(result.category.name, 'Recovery');
    assert.equal(result.category.subtitle, 'Mobility · Easy · Recovery');
    assert.equal(result.category.imageUrl, null);
    assert.equal(result.category.imageKey, 'recovery');
    assert.equal(result.workouts.length, 5);
    assert.equal(result.category.workoutCount, 5);
    assert.deepEqual(
        result.workouts.map((workout) => workout.id),
        ['wk_recovery_01', 'wk_recovery_02', 'wk_recovery_03', 'wk_recovery_04', 'wk_recovery_05']
    );
    for (const workout of result.workouts) {
        assert.equal(workout.type, 'recovery');
        assert.equal(workout.categoryName, 'Recovery');
        assert.ok(workout.activities.length > 0);
        assert.equal(workout.activityCount, workout.activities.length);
        assert.equal(workout.imageUrl, null);
        assert.equal(workout.activities[0].iconUrl, null);
        assert.ok(workout.activities.every((activity) => activity.target.durationSec > 0));
    }
    assert.equal(result.workouts[1].isSaved, true);
    assert.equal(result.workouts[0].isSaved, false);
});

test('unknown category is not found', async () => {
    await assert.rejects(
        () => listCategoryWorkouts('user-1', 'missing', async () => ({ rows: [] })),
        (error) => error.code === 'CATEGORY_NOT_FOUND'
    );
});

test('unknown workout id is not found', async () => {
    await assert.rejects(
        () => getWorkoutDetail('user-1', 'missing', async () => ({ rows: [] })),
        (error) => error.code === 'WORKOUT_NOT_FOUND'
    );
});

test('saving a workout twice keeps a single row and isSaved', async () => {
    const db = memoryQuery();
    const first = await saveWorkout('user-1', 'wk_foundation_a', db.query);
    const second = await saveWorkout('user-1', 'wk_foundation_a', db.query);
    const detail = await getWorkoutDetail('user-1', 'wk_foundation_a', db.query);

    assert.deepEqual(first, { isSaved: true });
    assert.deepEqual(second, { isSaved: true });
    assert.equal(db.rows.length, 1);
    assert.equal(detail.isSaved, true);

    const otherUser = await getWorkoutDetail('user-2', 'wk_foundation_a', db.query);
    assert.equal(otherUser.isSaved, false);
});

test('invalid workouts.json fails catalog load', () => {
    const file = path.join(os.tmpdir(), `roxclub-bad-workouts-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify([{ id: 'wk_bad', categoryId: 'missing' }]));

    assert.throws(
        () => loadWorkoutCatalog({ workoutsFile: file }),
        (error) => error.code === 'INVALID_WORKOUTS'
    );

    assert.throws(() => validateWorkouts([{ id: 'a' }, { id: 'a' }], [{ id: 'hybrid', name: 'Hybrid' }]));
    fs.unlinkSync(file);
});

test('duration filter keeps only workouts at or under maxDuration', () => {
    const page = listWorkoutPage({ maxDuration: 20 });
    assert.ok(page.workouts.length > 0);
    assert.ok(page.workouts.every((workout) => workout.durationMin <= 20));
    assert.equal(listWorkoutPage({ maxDuration: 'Any' }).workouts.length, listWorkoutPage({}).workouts.length);
});

test('search matches title and tags case-insensitively', () => {
    const byTitle = listWorkoutPage({ q: 'zone 2' });
    assert.ok(byTitle.workouts.some((workout) => workout.id === 'wk_zone2_run'));

    const byTag = listWorkoutPage({ q: 'HYROX' });
    assert.ok(byTag.workouts.length > 0);
    assert.ok(byTag.workouts.every((workout) => workout.categoryName === 'Hybrid Race'));

    const lower = listWorkoutPage({ q: 'intervals' });
    assert.ok(lower.workouts.some((workout) => workout.categoryName === 'Track' || workout.categoryName === 'Ergs'));
});

test('workout list is sorted by sortOrder then title and paginates with a cursor', () => {
    const first = listWorkouts({ limit: 2 });
    assert.equal(first.workouts.length, 2);
    assert.ok(first.nextCursor);
    assert.equal(first.workouts[0].id, 'wk_foundation_a');

    const second = listWorkouts({ limit: 2, cursor: first.nextCursor });
    assert.equal(second.workouts.length, 2);
    assert.notEqual(second.workouts[0].id, first.workouts[0].id);
    assert.notEqual(second.workouts[0].id, first.workouts[1].id);
});

test('cursor pagination returns no duplicates across pages', () => {
    const seen = new Set();
    let cursor = null;
    let pages = 0;
    for (;;) {
        const page = listWorkouts({ limit: 7, cursor });
        pages += 1;
        for (const workout of page.workouts) {
            assert.equal(seen.has(workout.id), false, `duplicate ${workout.id}`);
            seen.add(workout.id);
            assert.equal(workout.showInLibrary == null || workout.showInLibrary === true, true);
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
        assert.ok(pages < 20);
    }
    assert.ok(seen.size >= 7);
    assert.equal(seen.has('wk_foundation_a'), true);
    assert.equal(seen.has('wk_foundation_b'), false);
});

test('categoryId filter only returns library workouts in that category', () => {
    const page = listWorkoutPage({ categoryId: 'cat_hybrid_race', limit: 50 });
    assert.ok(page.workouts.length > 0);
    assert.ok(page.workouts.every((workout) => workout.categoryName === 'Hybrid Race'));
    assert.ok(page.workouts.some((workout) => workout.id === 'wk_foundation_a'));
    assert.equal(page.workouts.some((workout) => workout.id === 'wk_foundation_b'), false);
});

test('program-only workouts stay startable and out of the library list', async () => {
    assert.equal(getWorkout('wk_foundation_b')?.showInLibrary, false);
    assert.equal(listWorkoutPage({ q: 'Foundation Protocol B' }).workouts.length, 0);

    const detail = await getWorkoutDetail('user-1', 'wk_foundation_b', async () => ({ rows: [] }));
    assert.equal(detail.id, 'wk_foundation_b');

    const started = await startSession(
        'user-1',
        { workoutId: 'wk_foundation_b', idempotencyKey: 'program-only', startedAt: '2026-10-26T08:00:00.000Z' },
        {
            localDate: '2026-10-26',
            query: async (sql, params) => {
                if (sql.includes('workout:session_by_key')) return { rows: [] };
                if (sql.includes('workout:active_session')) return { rows: [] };
                if (sql.includes('workout:insert_session')) {
                    return {
                        rows: [
                            {
                                id: params[0],
                                workout_id: params[2],
                                status: 'in_progress',
                                started_at: params[4],
                            },
                        ],
                    };
                }
                throw new Error(`unexpected sql: ${sql}`);
            },
            enqueueReadinessRecompute: () => {},
        }
    );
    assert.equal(started.workoutId, 'wk_foundation_b');
    assert.ok(started.sessionId);
});

test('a duplicate id across workouts.json and program-workouts.json fails startup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roxclub-dup-'));
    const categories = path.join(dir, 'categories.json');
    const library = path.join(dir, 'workouts.json');
    const program = path.join(dir, 'program-workouts.json');
    fs.writeFileSync(
        categories,
        JSON.stringify([{ id: 'cat_hybrid_race', name: 'Hybrid Race', subtitle: 'Run + Stations' }])
    );
    const shared = {
        id: 'wk_dup',
        categoryId: 'cat_hybrid_race',
        type: 'hybrid',
        title: 'Dup',
        imageUrl: '/workouts/x.jpg',
        durationMin: 10,
        difficulty: 'Beginner',
        equipment: 'None',
        purpose: 'dup',
        activities: [
            {
                order: 1,
                kind: 'run',
                name: 'Run',
                iconUrl: 'icons/run.png',
                label: '1 km',
                target: { distanceM: 1000 },
            },
        ],
    };
    fs.writeFileSync(library, JSON.stringify([{ ...shared, showInLibrary: true }]));
    fs.writeFileSync(program, JSON.stringify([{ ...shared, showInLibrary: false }]));

    assert.throws(
        () =>
            loadWorkoutCatalog({
                workoutsFile: library,
                programWorkoutsFile: program,
                categoriesFile: categories,
                programs: { programs: {} },
            }),
        (error) => error.code === 'DUPLICATE_WORKOUT_ID'
    );
});

test('categories expose subtitle without changing ids', () => {
    const categories = listCategories();
    assert.deepEqual(
        categories.map((category) => category.id),
        [
            'cat_hybrid_race',
            'cat_track',
            'cat_strength',
            'cat_ergs',
            'cat_power',
            'cat_aerobic',
            'cat_conditioning',
            'cat_recovery',
        ]
    );
    assert.equal(categories[0].subtitle, 'Run + Stations');
    assert.equal(categories[1].subtitle, 'Road · Track · Intervals');
});

test('continue is null when today scheduled session is done', () => {
    assert.equal(
        continueFrom({
            id: 'sched-1',
            workout_id: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            duration_min: 45,
            status: 'done',
            completed_at: '2026-10-26T08:00:00.000Z',
        }),
        null
    );
    assert.deepEqual(
        continueFrom({
            id: 'sched-2',
            workout_id: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            duration_min: 45,
            status: 'pending',
            completed_at: null,
        }),
        {
            scheduledSessionId: 'sched-2',
            workoutId: 'wk_foundation_a',
            title: 'Foundation Protocol A',
            durationMin: 45,
            statusText: 'Not started today · 45 min',
        }
    );
    assert.equal(readinessHint({ status: 'CALIBRATING', score: null }), null);
    assert.equal(readinessHint({ status: 'READY', score: 78 }), 'You are ready to train');
});
