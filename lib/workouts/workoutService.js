const { queryWithHardTimeout } = require('../dbQuery');
const { createSavedWorkoutsTable } = require('../../models/Workouts/SavedWorkouts');
const { getWorkout, getCategoryName, loadWorkoutCatalog } = require('./workoutCatalog');
const { toWorkoutDetail, toSavedWorkoutSummary } = require('./workoutDto');

let tableReady = false;

function notFound() {
    const error = new Error('Workout not found');
    error.status = 404;
    error.code = 'WORKOUT_NOT_FOUND';
    return error;
}

function requireWorkout(id) {
    const workout = getWorkout(id);
    if (!workout) throw notFound();
    return workout;
}

async function ensureSavedWorkoutsTable(query = queryWithHardTimeout) {
    if (query !== queryWithHardTimeout) {
        await query(createSavedWorkoutsTable, []);
        return;
    }
    if (tableReady) return;
    await queryWithHardTimeout(createSavedWorkoutsTable, [], 8000);
    tableReady = true;
}

async function isWorkoutSaved(userId, workoutId, query = queryWithHardTimeout) {
    await ensureSavedWorkoutsTable(query);
    const { rows } = await query(
        `
        SELECT 1
        FROM saved_workouts
        WHERE user_id = $1 AND workout_id = $2
        `,
        [userId, workoutId],
        8000
    );
    return rows.length > 0;
}

async function getWorkoutDetail(userId, workoutId, query = queryWithHardTimeout) {
    const workout = requireWorkout(workoutId);
    const saved = await isWorkoutSaved(userId, workoutId, query);
    return toWorkoutDetail(workout, getCategoryName(workout.categoryId), saved);
}

async function saveWorkout(userId, workoutId, query = queryWithHardTimeout) {
    requireWorkout(workoutId);
    await ensureSavedWorkoutsTable(query);
    await query(
        `
        INSERT INTO saved_workouts (user_id, workout_id)
        VALUES ($1, $2)
        ON CONFLICT (user_id, workout_id) DO NOTHING
        `,
        [userId, workoutId],
        8000
    );
    return { isSaved: true };
}

async function unsaveWorkout(userId, workoutId, query = queryWithHardTimeout) {
    requireWorkout(workoutId);
    await ensureSavedWorkoutsTable(query);
    await query(
        `
        DELETE FROM saved_workouts
        WHERE user_id = $1 AND workout_id = $2
        `,
        [userId, workoutId],
        8000
    );
    return { isSaved: false };
}

async function listSavedWorkouts(userId, query = queryWithHardTimeout) {
    await ensureSavedWorkoutsTable(query);
    const { rows } = await query(
        `
        SELECT workout_id
        FROM saved_workouts
        WHERE user_id = $1
        ORDER BY created_at DESC
        `,
        [userId],
        8000
    );

    return rows
        .map((row) => getWorkout(row.workout_id))
        .filter(Boolean)
        .map(toSavedWorkoutSummary);
}

module.exports = {
    loadWorkoutCatalog,
    getWorkoutDetail,
    saveWorkout,
    unsaveWorkout,
    listSavedWorkouts,
};
