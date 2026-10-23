const fs = require('fs');
const path = require('path');
const { validateWorkouts } = require('./validateWorkouts');

const defaultWorkoutsFile = path.join(__dirname, '../../data/workouts.json');
const defaultCategoriesFile = path.join(__dirname, '../../data/workout-categories.json');

let workoutsById = new Map();
let categoriesById = new Map();

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadWorkoutCatalog(options = {}) {
    const workoutsFile = options.workoutsFile || defaultWorkoutsFile;
    const categoriesFile = options.categoriesFile || defaultCategoriesFile;
    const categories = readJson(categoriesFile);
    const workouts = validateWorkouts(readJson(workoutsFile), categories);

    const nextWorkouts = new Map();
    for (const workout of workouts) nextWorkouts.set(workout.id, workout);

    const nextCategories = new Map();
    for (const category of categories) nextCategories.set(category.id, category.name);

    if (!options.workoutsFile && !options.categoriesFile) {
        workoutsById = nextWorkouts;
        categoriesById = nextCategories;
    }

    return { workouts: nextWorkouts, categories: nextCategories };
}

function catalog() {
    if (workoutsById.size === 0) loadWorkoutCatalog();
    return { workouts: workoutsById, categories: categoriesById };
}

function getWorkout(id) {
    return catalog().workouts.get(id) || null;
}

function getCategoryName(categoryId) {
    return catalog().categories.get(categoryId) || null;
}

module.exports = {
    loadWorkoutCatalog,
    getWorkout,
    getCategoryName,
};
