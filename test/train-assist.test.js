const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWorkoutCatalog, getWorkout, listAllLibraryWorkouts } = require('../lib/workouts/workoutCatalog');
const {
    GOVERNANCE,
    classifyQuery,
    getTrainAssist,
    recommendFromLibrary,
    alternativesFor,
    explainWorkout,
} = require('../lib/workouts/trainAssist');

loadWorkoutCatalog();

const approvedIds = new Set(listAllLibraryWorkouts().map((workout) => workout.id));

function assertApprovedOnly(workouts) {
    assert.ok(Array.isArray(workouts));
    assert.ok(workouts.length > 0);
    for (const item of workouts) {
        assert.ok(approvedIds.has(item.id), `invented or hidden id ${item.id}`);
        const workout = getWorkout(item.id);
        assert.equal(workout.showInLibrary, true);
    }
}

test('classify maps library language without inventing a workout', () => {
    const hyrox = classifyQuery('30 min hyrox');
    assert.equal(hyrox.categoryId, 'cat_hybrid_race');
    assert.equal(hyrox.type, 'hybrid');
    assert.equal(hyrox.maxDuration, 30);
    assert.equal(hyrox.medicalBoundary, null);

    const injury = classifyQuery('knee injury pain rehab please');
    assert.equal(injury.type, 'recovery');
    assert.match(injury.medicalBoundary, /cannot diagnose/);
});

test('recommend 30 min HYROX stays inside approved catalog', async () => {
    const result = await getTrainAssist(
        'user-1',
        { q: '30 min hyrox', intent: 'recommend' },
        { daily: { status: 'READY', score: 78 } }
    );

    assert.equal(result.intent, 'recommend');
    assert.deepEqual(result.governance, GOVERNANCE);
    assert.equal(result.governance.aiMayInvent, false);
    assert.equal(result.classification.categoryId, 'cat_hybrid_race');
    assert.equal(result.classification.maxDuration, 30);
    assertApprovedOnly(result.workouts);
    assert.ok(result.workouts.every((item) => item.durationMin <= 30));
    assert.ok(result.workouts.every((item) => item.type === 'hybrid'));
    assert.match(result.explanation, /approved library/i);
    assert.equal(result.userMayStillTrain, true);
});

test('low readiness prefers approved easier options and still allows override', async () => {
    const result = await getTrainAssist(
        'user-1',
        { intent: 'recommend' },
        { daily: { status: 'FATIGUED', score: 40 } }
    );

    assertApprovedOnly(result.workouts);
    assert.ok(
        result.workouts.every((item) => item.type === 'recovery' || item.difficulty === 'Beginner')
    );
    assert.equal(result.userMayStillTrain, true);
    assert.match(result.explanation, /You may still train/i);
});

test('smart swap returns similar approved workouts, never the same id', async () => {
    const source = getWorkout('wk_foundation_a');
    const picks = alternativesFor(source, { status: 'READY' }, 3);
    assert.ok(picks.every((workout) => workout.id !== 'wk_foundation_a'));
    assert.ok(picks.every((workout) => workout.showInLibrary));
    assert.ok(picks.some((workout) => workout.type === 'hybrid'));

    const result = await getTrainAssist(
        'user-1',
        { workoutId: 'wk_foundation_a', intent: 'swap' },
        { daily: { status: 'READY', score: 80 } }
    );
    assert.equal(result.intent, 'swap');
    assert.equal(result.original.id, 'wk_foundation_a');
    assertApprovedOnly(result.workouts);
    assert.ok(result.workouts.every((item) => item.id !== 'wk_foundation_a'));
});

test('explain uses authored purpose and does not invent content', () => {
    const source = getWorkout('wk_foundation_a');
    const explained = explainWorkout(source);
    assert.equal(explained.intent, 'explain');
    assert.equal(explained.workout.id, 'wk_foundation_a');
    assert.equal(explained.workout.purpose, source.purpose);
    assert.match(explained.explanation, /not generated/);
});

test('unknown workout is not invented', async () => {
    await assert.rejects(
        () =>
            getTrainAssist(
                'user-1',
                { workoutId: 'wk_invented_ai', intent: 'swap' },
                { daily: null }
            ),
        (error) => error.code === 'WORKOUT_NOT_FOUND'
    );
});

test('recommendFromLibrary never emits ids outside the catalog', () => {
    const picks = recommendFromLibrary({ q: 'legs at home', preferHome: true }, null, 5);
    assert.ok(picks.every((workout) => approvedIds.has(workout.id)));
});
