const TYPES = new Set(['hybrid', 'run', 'strength', 'recovery']);
const DIFFICULTIES = new Set(['Beginner', 'Intermediate', 'Advanced']);
const KINDS = new Set(['run', 'station', 'roxzone', 'strength_exercise', 'recovery_block']);
const TARGET_KEYS = ['distanceM', 'reps', 'loadKg', 'sets', 'restSec', 'durationSec'];

function fail(message) {
    const error = new Error(`Invalid workouts catalog: ${message}`);
    error.code = 'INVALID_WORKOUTS';
    throw error;
}

function requireString(value, label) {
    if (typeof value !== 'string' || !value.trim()) fail(`${label} must be a non-empty string`);
    return value.trim();
}

function requireNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        fail(`${label} must be a non-negative number`);
    }
    return value;
}

function validateTarget(target, label) {
    if (!target || typeof target !== 'object' || Array.isArray(target)) {
        fail(`${label} target must be an object`);
    }
    const cleaned = {};
    for (const key of TARGET_KEYS) {
        if (target[key] == null) continue;
        cleaned[key] = requireNumber(target[key], `${label} target.${key}`);
    }
    return cleaned;
}

function validateActivities(activities, workoutId) {
    if (!Array.isArray(activities) || activities.length === 0) {
        fail(`${workoutId} needs at least one activity`);
    }

    const orders = activities.map((activity, index) => {
        if (!activity || typeof activity !== 'object') fail(`${workoutId} activity ${index} is invalid`);
        return activity.order;
    });

    for (let index = 0; index < orders.length; index += 1) {
        if (orders[index] !== index + 1) {
            fail(`${workoutId} activities must be sorted by order starting at 1`);
        }
    }

    return activities.map((activity) => {
        const kind = requireString(activity.kind, `${workoutId} activity kind`);
        if (!KINDS.has(kind)) fail(`${workoutId} has unknown activity kind ${kind}`);
        const cleaned = {
            order: activity.order,
            kind,
            name: requireString(activity.name, `${workoutId} activity name`),
            iconUrl: requireString(activity.iconUrl, `${workoutId} activity iconUrl`),
            label: requireString(activity.label, `${workoutId} activity label`),
            target: validateTarget(activity.target, `${workoutId} ${activity.name}`),
        };
        if (activity.notes != null) {
            cleaned.notes = requireString(activity.notes, `${workoutId} activity notes`);
        }
        if (activity.loadRule != null) {
            cleaned.loadRule = requireString(activity.loadRule, `${workoutId} activity loadRule`);
        }
        if (activity.paceIntensity != null) {
            cleaned.paceIntensity = requireString(
                activity.paceIntensity,
                `${workoutId} activity paceIntensity`
            );
        }
        if (activity.movementId != null) {
            cleaned.movementId = requireString(activity.movementId, `${workoutId} activity movementId`);
        }
        return cleaned;
    });
}

function optionalStringList(value, label) {
    if (value == null) return [];
    if (!Array.isArray(value)) fail(`${label} must be an array`);
    return value.map((entry, index) => requireString(entry, `${label}[${index}]`));
}

function validateWorkouts(workouts, categories) {
    if (!Array.isArray(workouts) || workouts.length === 0) fail('workouts must be a non-empty array');
    if (!Array.isArray(categories) || categories.length === 0) fail('categories must be a non-empty array');

    const categoryIds = new Set();
    for (const category of categories) {
        const id = requireString(category.id, 'category id');
        requireString(category.name, `category ${id} name`);
        if (category.subtitle != null) requireString(category.subtitle, `category ${id} subtitle`);
        if (categoryIds.has(id)) fail(`duplicate category id ${id}`);
        categoryIds.add(id);
    }

    const seen = new Set();
    return workouts.map((workout) => {
        const id = requireString(workout.id, 'workout id');
        if (seen.has(id)) fail(`duplicate workout id ${id}`);
        seen.add(id);

        const categoryId = requireString(workout.categoryId, `${id} categoryId`);
        if (!categoryIds.has(categoryId)) fail(`${id} has unknown categoryId ${categoryId}`);

        const type = requireString(workout.type, `${id} type`);
        if (!TYPES.has(type)) fail(`${id} has unknown type ${type}`);

        const difficulty = requireString(workout.difficulty, `${id} difficulty`);
        if (!DIFFICULTIES.has(difficulty)) fail(`${id} has unknown difficulty ${difficulty}`);
        if (workout.autoRoxzone != null && typeof workout.autoRoxzone !== 'boolean') {
            fail(`${id} autoRoxzone must be a boolean`);
        }

        let tags = [];
        if (workout.tags != null) {
            if (!Array.isArray(workout.tags)) fail(`${id} tags must be an array`);
            tags = workout.tags.map((tag, index) => requireString(tag, `${id} tags[${index}]`));
        }

        const sortOrder =
            workout.sortOrder == null ? 0 : requireNumber(workout.sortOrder, `${id} sortOrder`);

        if (workout.showInLibrary != null && typeof workout.showInLibrary !== 'boolean') {
            fail(`${id} showInLibrary must be a boolean`);
        }

        const cleaned = {
            id,
            categoryId,
            type,
            title: requireString(workout.title, `${id} title`),
            imageUrl: requireString(workout.imageUrl, `${id} imageUrl`),
            durationMin: requireNumber(workout.durationMin, `${id} durationMin`),
            difficulty,
            author: workout.author == null ? 'ROX CLUB' : requireString(workout.author, `${id} author`),
            equipment: requireString(workout.equipment, `${id} equipment`),
            purpose: requireString(workout.purpose, `${id} purpose`),
            tags,
            sortOrder,
            showInLibrary: workout.showInLibrary === true,
            autoRoxzone: workout.autoRoxzone == null ? type === 'hybrid' : workout.autoRoxzone,
            activities: validateActivities(workout.activities, id),
        };
        if (workout.format != null) {
            cleaned.format = requireString(workout.format, `${id} format`);
        }
        if (workout.source != null) {
            cleaned.source = requireString(workout.source, `${id} source`);
        }
        const instructions = optionalStringList(workout.instructions, `${id} instructions`);
        if (instructions.length > 0) cleaned.instructions = instructions;
        return cleaned;
    });
}

module.exports = { validateWorkouts };
