const fs = require('fs');
const path = require('path');
const programs = require('../../data/programs.json');
const { validateWorkouts } = require('./validateWorkouts');

const defaultWorkoutsFile = path.join(__dirname, '../../data/workouts.json');
const defaultProgramWorkoutsFile = path.join(__dirname, '../../data/program-workouts.json');
const defaultCategoriesFile = path.join(__dirname, '../../data/categories.json');

let workoutsById = new Map();
let categoriesById = new Map();

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertNoDuplicateIds(libraryWorkouts, programWorkouts) {
    const seen = new Map();
    const duplicates = new Set();
    for (const [source, rows] of [
        ['workouts.json', libraryWorkouts],
        ['program-workouts.json', programWorkouts],
    ]) {
        if (!Array.isArray(rows)) continue;
        for (const workout of rows) {
            const id = workout?.id;
            if (typeof id !== 'string' || !id.trim()) continue;
            if (seen.has(id)) {
                duplicates.add(`${id} (${seen.get(id)} and ${source})`);
            } else {
                seen.set(id, source);
            }
        }
    }
    if (duplicates.size === 0) return;
    const error = new Error(`Duplicate workout ids across catalog files: ${[...duplicates].sort().join(', ')}`);
    error.code = 'DUPLICATE_WORKOUT_ID';
    error.duplicates = [...duplicates].sort();
    throw error;
}

function loadWorkoutCatalog(options = {}) {
    const workoutsFile = options.workoutsFile || defaultWorkoutsFile;
    const categoriesFile = options.categoriesFile || defaultCategoriesFile;
    const programWorkoutsFile =
        options.programWorkoutsFile === undefined
            ? options.workoutsFile
                ? null
                : defaultProgramWorkoutsFile
            : options.programWorkoutsFile;

    const categories = readJson(categoriesFile);
    const libraryRaw = readJson(workoutsFile);
    const programRaw = programWorkoutsFile ? readJson(programWorkoutsFile) : [];
    assertNoDuplicateIds(libraryRaw, programRaw);

    const workouts = validateWorkouts([...libraryRaw, ...programRaw], categories);

    const nextWorkouts = new Map();
    for (const workout of workouts) nextWorkouts.set(workout.id, workout);

    const nextCategories = new Map();
    for (const category of categories) {
        nextCategories.set(category.id, {
            id: category.id,
            name: category.name,
            subtitle: category.subtitle || '',
            sortOrder: Number(category.sortOrder) || 0,
            showOnHome: Boolean(category.showOnHome),
            imageUrl: category.imageUrl || '',
        });
    }

    if ((!options.workoutsFile && options.programWorkoutsFile === undefined) || options.programs) {
        assertProgramWorkouts(nextWorkouts, options.programs || programs);
    }

    if (!options.workoutsFile && !options.categoriesFile && options.programWorkoutsFile === undefined) {
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
        subtitle: category.subtitle || null,
        sortOrder: category.sortOrder,
        showOnHome: category.showOnHome,
        imageKey: imageKey(category.imageUrl),
        imageUrl: null,
        workoutCount,
    };
}

function workoutSortKey(workout) {
    return {
        sortOrder: Number(workout.sortOrder) || 0,
        title: String(workout.title || ''),
        id: String(workout.id || ''),
    };
}

function compareWorkouts(left, right) {
    const a = workoutSortKey(left);
    const b = workoutSortKey(right);
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const byTitle = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    if (byTitle !== 0) return byTitle;
    return a.id.localeCompare(b.id);
}

function encodeWorkoutCursor(workout) {
    return Buffer.from(JSON.stringify(workoutSortKey(workout)), 'utf8').toString('base64url');
}

function decodeWorkoutCursor(cursor) {
    if (!cursor) return null;
    try {
        const parsed = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            sortOrder: Number(parsed.sortOrder) || 0,
            title: String(parsed.title || ''),
            id: String(parsed.id || ''),
        };
    } catch (_) {
        return null;
    }
}

function isAfterCursor(workout, cursor) {
    if (!cursor) return true;
    const key = workoutSortKey(workout);
    if (key.sortOrder !== cursor.sortOrder) return key.sortOrder > cursor.sortOrder;
    const byTitle = key.title.localeCompare(cursor.title, undefined, { sensitivity: 'base' });
    if (byTitle !== 0) return byTitle > 0;
    return key.id.localeCompare(cursor.id) > 0;
}

function matchesQuery(workout, q) {
    if (!q) return true;
    const needle = q.toLowerCase();
    if (String(workout.title || '').toLowerCase().includes(needle)) return true;
    return (workout.tags || []).some((tag) => String(tag).toLowerCase().includes(needle));
}

function listWorkouts(filters = {}) {
    const {
        categoryId = null,
        type = null,
        difficulty = null,
        maxDuration = null,
        q = null,
        limit = 20,
        cursor = null,
    } = filters;

    const decoded = cursor ? decodeWorkoutCursor(cursor) : null;
    if (cursor && !decoded) {
        const error = new Error('Invalid cursor');
        error.status = 400;
        error.code = 'INVALID_CURSOR';
        throw error;
    }

    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const category = categoryId ? findCategory(categoryId) : null;
    if (categoryId && !category) {
        const error = new Error('Category not found');
        error.status = 404;
        error.code = 'CATEGORY_NOT_FOUND';
        throw error;
    }

    const queryText = q == null || String(q).trim() === '' ? null : String(q).trim();
    let maxMin = null;
    if (maxDuration != null && String(maxDuration).trim() !== '' && String(maxDuration).toLowerCase() !== 'any') {
        maxMin = Number(maxDuration);
        if (!Number.isFinite(maxMin) || maxMin < 0) {
            const error = new Error('maxDuration must be a non-negative number or Any');
            error.status = 400;
            error.code = 'INVALID_MAX_DURATION';
            throw error;
        }
    }

    const typeFilter = type == null || String(type).trim() === '' ? null : String(type).trim();
    const difficultyFilter =
        difficulty == null || String(difficulty).trim() === '' ? null : String(difficulty).trim();

    const matched = [...catalog().workouts.values()]
        .filter((workout) => {
            if (!workout.showInLibrary) return false;
            if (category && workout.categoryId !== category.id) return false;
            if (typeFilter && workout.type !== typeFilter) return false;
            if (difficultyFilter && workout.difficulty !== difficultyFilter) return false;
            if (maxMin != null && workout.durationMin > maxMin) return false;
            if (!matchesQuery(workout, queryText)) return false;
            return isAfterCursor(workout, decoded);
        })
        .sort(compareWorkouts);

    const page = matched.slice(0, safeLimit);
    const nextCursor = matched.length > safeLimit ? encodeWorkoutCursor(page[page.length - 1]) : null;
    return { workouts: page, nextCursor };
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
        if (!workout.showInLibrary) continue;
        counts.set(workout.categoryId, (counts.get(workout.categoryId) || 0) + 1);
    }

    let list = [...categories.values()].sort((left, right) => left.sortOrder - right.sortOrder);
    if (homeOnly) list = list.filter((category) => category.showOnHome).slice(0, 3);

    return list.map((category) => toCategoryDto(category, counts.get(category.id) || 0));
}

module.exports = {
    loadWorkoutCatalog,
    assertProgramWorkouts,
    assertNoDuplicateIds,
    getWorkout,
    getCategoryName,
    findCategory,
    listWorkoutsForCategory,
    listWorkouts,
    toCategoryDto,
    listCategories,
};
