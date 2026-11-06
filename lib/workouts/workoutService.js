const { queryWithHardTimeout } = require('../dbQuery');
const { createSavedWorkoutsTable } = require('../../models/Workouts/SavedWorkouts');
const {
    getWorkout,
    getCategoryName,
    findCategory,
    listWorkoutsForCategory,
    listWorkouts: catalogListWorkouts,
    toCategoryDto,
    loadWorkoutCatalog,
} = require('./workoutCatalog');
const { toWorkoutDetail, toSavedWorkoutSummary, toWorkoutListItem } = require('./workoutDto');

let tableReady = false;

function notFound() {
    const error = new Error('Workout not found');
    error.status = 404;
    error.code = 'WORKOUT_NOT_FOUND';
    return error;
}

async function resolvePlayableWorkout(userId, workoutId, query = queryWithHardTimeout) {
    const catalog = getWorkout(workoutId);
    if (catalog) return catalog;
    const { getUserWorkout } = require('./userWorkoutService');
    const custom = await getUserWorkout(userId, workoutId, query);
    if (custom) return custom;
    throw notFound();
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
    const workout = await resolvePlayableWorkout(userId, workoutId, query);
    const saved = await isWorkoutSaved(userId, workoutId, query);
    return toWorkoutDetail(workout, getCategoryName(workout.categoryId), saved);
}

async function saveWorkout(userId, workoutId, query = queryWithHardTimeout) {
    await resolvePlayableWorkout(userId, workoutId, query);
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
    await resolvePlayableWorkout(userId, workoutId, query);
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

async function listCategoryWorkouts(userId, categoryKey, query = queryWithHardTimeout) {
    const category = findCategory(categoryKey);
    if (!category) {
        const error = new Error('Category not found');
        error.status = 404;
        error.code = 'CATEGORY_NOT_FOUND';
        throw error;
    }

    const workouts = listWorkoutsForCategory(category.id);
    await ensureSavedWorkoutsTable(query);
    const { rows } = await query(
        `
        SELECT workout_id
        FROM saved_workouts
        WHERE user_id = $1 AND workout_id = ANY($2::varchar[])
        `,
        [userId, workouts.map((workout) => workout.id)],
        8000
    );
    const savedIds = new Set(rows.map((row) => row.workout_id));

    return {
        category: toCategoryDto(category, workouts.length),
        workouts: workouts.map((workout) =>
            toWorkoutDetail(workout, category.name, savedIds.has(workout.id))
        ),
    };
}

function listWorkouts(filters = {}) {
    const page = catalogListWorkouts(filters);
    return {
        workouts: page.workouts.map((workout) =>
            toWorkoutListItem(workout, getCategoryName(workout.categoryId))
        ),
        nextCursor: page.nextCursor,
    };
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

    const { getUserWorkout } = require('./userWorkoutService');
    const workouts = [];
    for (const row of rows) {
        const catalog = getWorkout(row.workout_id);
        if (catalog) {
            workouts.push(catalog);
            continue;
        }
        const custom = await getUserWorkout(userId, row.workout_id, query);
        if (custom) workouts.push(custom);
    }
    return workouts.map(toSavedWorkoutSummary);
}

module.exports = {
    loadWorkoutCatalog,
    getWorkoutDetail,
    resolvePlayableWorkout,
    isWorkoutSaved,
    saveWorkout,
    unsaveWorkout,
    listSavedWorkouts,
    listCategoryWorkouts,
    listWorkouts,
};
