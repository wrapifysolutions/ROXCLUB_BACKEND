const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.ASSET_BASE_URL = 'https://assets.roxclub.app';

const { loadWorkoutCatalog } = require('../lib/workouts/workoutCatalog');
const { validateWorkouts } = require('../lib/workouts/validateWorkouts');
const { getWorkoutDetail, saveWorkout } = require('../lib/workouts/workoutService');

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
    assert.equal(detail.categoryName, 'Hybrid');
    assert.equal(detail.author, 'ROX CLUB');
    assert.equal(detail.imageKey, 'wk_foundation_a');
    assert.equal(detail.imageUrl, null);
    assert.equal(detail.activities[0].iconKey, 'run');
    assert.equal(detail.activities[4].iconKey, 'sled');
    assert.equal(detail.isSaved, false);
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
