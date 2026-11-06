const crypto = require('crypto');
const { queryWithHardTimeout } = require('../dbQuery');
const { parseNovaText } = require('./novaParse');
const { getCategoryName, findCategory } = require('./workoutCatalog');
const { toWorkoutDetail, toWorkoutListItem } = require('./workoutDto');

const createUserWorkoutsTable = `
CREATE TABLE IF NOT EXISTS user_workouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    category_id VARCHAR(60),
    type VARCHAR(40) NOT NULL,
    duration_min INTEGER NOT NULL,
    difficulty VARCHAR(40),
    source VARCHAR(40) NOT NULL DEFAULT 'nova_text',
    purpose TEXT,
    activities JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
`;

const createUserWorkoutsIndex = `
CREATE INDEX IF NOT EXISTS user_workouts_user_idx
    ON user_workouts (user_id, updated_at DESC)
`;

let tableReady = false;

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

function asActivities(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }
    return [];
}

function toPlayable(row) {
    if (!row) return null;
    return {
        id: row.id,
        title: row.title,
        categoryId: row.category_id,
        type: row.type,
        durationMin: Number(row.duration_min),
        difficulty: row.difficulty || 'Intermediate',
        author: 'NOVA',
        source: row.source || 'nova_text',
        purpose: row.purpose || null,
        equipment: null,
        showInLibrary: false,
        imageUrl: '',
        activities: asActivities(row.activities),
    };
}

async function ensureUserWorkoutsTable(query = queryWithHardTimeout) {
    if (query !== queryWithHardTimeout) {
        try {
            await query(createUserWorkoutsTable, []);
            await query(createUserWorkoutsIndex, []);
        } catch (error) {
            if (error.code !== '42P01' && error.code !== '42703') throw error;
        }
        return;
    }
    if (tableReady) return;
    try {
        await queryWithHardTimeout(createUserWorkoutsTable, [], 8000);
        await queryWithHardTimeout(createUserWorkoutsIndex, [], 8000);
        tableReady = true;
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return;
        throw error;
    }
}

async function getUserWorkout(userId, workoutId, query = queryWithHardTimeout) {
    if (!userId || !workoutId) return null;
    try {
        await ensureUserWorkoutsTable(query);
        const { rows } = await query(
            `
            /* nova:load_user_workout */
            SELECT id, user_id, title, category_id, type, duration_min, difficulty,
                   source, purpose, activities
            FROM user_workouts
            WHERE id = $1 AND user_id = $2
            `,
            [workoutId, userId],
            8000
        );
        return toPlayable(rows[0]);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return null;
        throw error;
    }
}

function sanitizeActivities(activities) {
    if (!Array.isArray(activities) || activities.length === 0) {
        throw httpError('NOVA_NO_EXERCISES', 400, 'At least one exercise is required');
    }
    return activities.map((activity, index) => {
        const kind = String(activity.kind || '').trim();
        if (!['run', 'station', 'roxzone', 'strength_exercise', 'recovery_block'].includes(kind)) {
            throw httpError('INVALID_NOVA_ACTIVITY', 400, `activity ${index} has an unknown kind`);
        }
        const name = String(activity.name || '').trim();
        if (!name) throw httpError('INVALID_NOVA_ACTIVITY', 400, `activity ${index} needs a name`);
        const target = activity.target && typeof activity.target === 'object' ? activity.target : {};
        return {
            order: index + 1,
            kind,
            name,
            iconUrl: activity.iconUrl || null,
            target,
            label: activity.label || name,
        };
    });
}

async function createUserWorkout(userId, body, query = queryWithHardTimeout) {
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    await ensureUserWorkoutsTable(query);
    const parsed = body?.activities ? null : parseNovaText(body?.q || body?.text);
    const draft = parsed || {
        title: String(body.title || '').trim() || 'NOVA workout',
        categoryId: body.categoryId || 'cat_hybrid_race',
        type: body.type || 'hybrid',
        durationMin: Number(body.durationMin) || 30,
        difficulty: body.difficulty || 'Intermediate',
        source: 'nova_text',
        purpose: body.purpose || body.q || null,
        activities: sanitizeActivities(body.activities),
    };
    if (body?.title) draft.title = String(body.title).trim();
    if (Array.isArray(body?.activities) && parsed) draft.activities = sanitizeActivities(body.activities);
    if (draft.categoryId && !findCategory(draft.categoryId)) {
        draft.categoryId = 'cat_hybrid_race';
    }
    const id = crypto.randomUUID();
    await query(
        `
        /* nova:insert_user_workout */
        INSERT INTO user_workouts (
            id, user_id, title, category_id, type, duration_min, difficulty, source, purpose, activities
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
        `,
        [
            id,
            userId,
            draft.title,
            draft.categoryId || null,
            draft.type,
            draft.durationMin,
            draft.difficulty,
            draft.source || 'nova_text',
            draft.purpose || null,
            JSON.stringify(draft.activities),
        ],
        8000
    );
    return getUserWorkout(userId, id, query);
}

async function updateUserWorkout(userId, workoutId, body, query = queryWithHardTimeout) {
    const current = await getUserWorkout(userId, workoutId, query);
    if (!current) throw httpError('WORKOUT_NOT_FOUND', 404, 'Workout not found');
    const next = {
        title: body.title != null ? String(body.title).trim() : current.title,
        categoryId: body.categoryId || current.categoryId,
        type: body.type || current.type,
        durationMin: body.durationMin != null ? Number(body.durationMin) : current.durationMin,
        difficulty: body.difficulty || current.difficulty,
        purpose: body.purpose != null ? body.purpose : current.purpose,
        activities: Array.isArray(body.activities) ? sanitizeActivities(body.activities) : current.activities,
    };
    await query(
        `
        /* nova:update_user_workout */
        UPDATE user_workouts
        SET title = $3, category_id = $4, type = $5, duration_min = $6,
            difficulty = $7, purpose = $8, activities = $9::jsonb, updated_at = NOW()
        WHERE id = $1 AND user_id = $2
        `,
        [
            workoutId,
            userId,
            next.title,
            next.categoryId || null,
            next.type,
            next.durationMin,
            next.difficulty,
            next.purpose || null,
            JSON.stringify(next.activities),
        ],
        8000
    );
    return getUserWorkout(userId, workoutId, query);
}

async function listUserWorkouts(userId, query = queryWithHardTimeout) {
    await ensureUserWorkoutsTable(query);
    try {
        const { rows } = await query(
            `
            /* nova:list_user_workouts */
            SELECT id, title, category_id, type, duration_min, difficulty, source, purpose, activities
            FROM user_workouts
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 50
            `,
            [userId],
            8000
        );
        return rows.map((row) => toPlayable(row)).filter(Boolean);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return [];
        throw error;
    }
}

function toDetail(workout, isSaved) {
    return toWorkoutDetail(workout, getCategoryName(workout.categoryId), isSaved);
}

function toListItem(workout) {
    return toWorkoutListItem(workout, getCategoryName(workout.categoryId));
}

module.exports = {
    createUserWorkoutsTable,
    createUserWorkoutsIndex,
    getUserWorkout,
    createUserWorkout,
    updateUserWorkout,
    listUserWorkouts,
    toPlayable,
    toDetail,
    toListItem,
};
