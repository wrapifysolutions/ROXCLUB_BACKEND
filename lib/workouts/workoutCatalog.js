const fs = require('fs');
const path = require('path');
const programs = require('../../data/programs.json');
const { validateWorkouts } = require('./validateWorkouts');

const defaultWorkoutsFile = path.join(__dirname, '../../data/workouts.json');
const defaultCategoriesFile = path.join(__dirname, '../../data/categories.json');

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
    for (const category of categories) {
        nextCategories.set(category.id, {
            id: category.id,
            name: category.name,
            sortOrder: Number(category.sortOrder) || 0,
            showOnHome: Boolean(category.showOnHome),
            imageUrl: category.imageUrl || '',
        });
    }

    if (!options.workoutsFile || options.programs) {
        assertProgramWorkouts(nextWorkouts, options.programs || programs);
    }

    if (!options.workoutsFile && !options.categoriesFile) {
        workoutsById = nextWorkouts;
        categoriesById = nextCategories;
    }

    return { workouts: nextWorkouts, categories: nextCategories };
}

function assertProgramWorkouts(workouts, programCatalog = programs) {
    const known = workouts instanceof Map ? new Set(workouts.keys()) : new Set(workouts);
    const missing = new Set();
    for (const program of Object.values(programCatalog.programs || {})) {
        for (const week of program.weeks || []) {
            for (const day of week.days || []) {
                if (!known.has(day.workoutId)) missing.add(day.workoutId);
            }
        }
    }
    if (missing.size === 0) return;
    const ids = [...missing].sort();
    const error = new Error(`Program catalog references unknown workout ids: ${ids.join(', ')}`);
    error.code = 'UNKNOWN_PROGRAM_WORKOUTS';
    error.missing = ids;
    throw error;
}

function catalog() {
    if (workoutsById.size === 0) loadWorkoutCatalog();
    return { workouts: workoutsById, categories: categoriesById };
}

function getWorkout(id) {
    return catalog().workouts.get(id) || null;
}

function imageKey(relativePath) {
    const name = String(relativePath || '').split('/').pop() || '';
    return name.replace(/\.[a-z0-9]+$/i, '');
}

function getCategoryName(categoryId) {
    const category = catalog().categories.get(categoryId);
    if (!category) return null;
    return typeof category === 'string' ? category : category.name;
}

function toCategoryDto(category, workoutCount) {
    return {
        id: category.id,
        name: category.name,
        sortOrder: category.sortOrder,
        showOnHome: category.showOnHome,
        imageKey: imageKey(category.imageUrl),
        imageUrl: null,
        workoutCount,
    };
}

function findCategory(key) {
    const needle = String(key || '').trim().toLowerCase();
    if (!needle) return null;
    for (const category of catalog().categories.values()) {
        if (
            category.id.toLowerCase() === needle ||
            category.name.toLowerCase() === needle ||
            imageKey(category.imageUrl).toLowerCase() === needle
        ) {
            return category;
        }
    }
    return null;
}

function listWorkoutsForCategory(categoryId) {
    return [...catalog().workouts.values()].filter((workout) => workout.categoryId === categoryId);
}

function listCategories({ homeOnly = false } = {}) {
    const { workouts, categories } = catalog();
    const counts = new Map();
    for (const workout of workouts.values()) {
        counts.set(workout.categoryId, (counts.get(workout.categoryId) || 0) + 1);
    }

    let list = [...categories.values()].sort((left, right) => left.sortOrder - right.sortOrder);
    if (homeOnly) list = list.filter((category) => category.showOnHome).slice(0, 3);

    return list.map((category) => toCategoryDto(category, counts.get(category.id) || 0));
}

module.exports = {
    loadWorkoutCatalog,
    assertProgramWorkouts,
    getWorkout,
    getCategoryName,
    findCategory,
    listWorkoutsForCategory,
    toCategoryDto,
    listCategories,
};
