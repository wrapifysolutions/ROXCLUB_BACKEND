const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { connectDB, closeDB } = require('../../lib/db');
const { queryWithHardTimeout } = require('../../lib/dbQuery');
const { createAccessToken } = require('../../lib/token');
const app = require('../../server');

const TIMEOUT = 120000;

let server;
let base;
let token;
let activityToken;
let userId;
let activityUserId;
let existingActivityId;
let novaIds = [];
let sessionIds = [];
let skipReason = null;

async function jsonRequest(method, path, body, authToken) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const response = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
        json = await response.json();
    } catch (_) {
        json = null;
    }
    return { status: response.status, json };
}

test.before(async () => {
    try {
        await connectDB();
    } catch (error) {
        skipReason = `database unavailable: ${error.message}`;
        return;
    }
    if (!process.env.JWT_SECRET) {
        skipReason = 'JWT_SECRET is not set';
        return;
    }

    server = await new Promise((resolve, reject) => {
        const started = app.listen(0, '127.0.0.1', () => resolve(started));
        started.on('error', reject);
    });
    base = `http://127.0.0.1:${server.address().port}`;

    const athletes = await queryWithHardTimeout(
        `
        SELECT u.id, u.email
        FROM users u
        LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
        WHERE u.is_email_verified = true
          AND (u.onboarding_completed = true OR oq.is_completed = true)
        ORDER BY u.created_at DESC NULLS LAST
        LIMIT 1
        `,
        [],
        8000
    );
    if (!athletes.rows[0]) {
        skipReason = 'no verified onboarded athlete';
        return;
    }
    userId = athletes.rows[0].id;
    token = createAccessToken({
        id: athletes.rows[0].id,
        email: athletes.rows[0].email,
        auth_provider: 'email',
    });

    const history = await queryWithHardTimeout(
        `
        SELECT a.id, a.user_id, u.email
        FROM activities a
        JOIN users u ON u.id = a.user_id
        WHERE u.is_email_verified = true
        ORDER BY a.start_at DESC
        LIMIT 1
        `,
        [],
        8000
    );
    if (history.rows[0]) {
        existingActivityId = history.rows[0].id;
        activityUserId = history.rows[0].user_id;
        activityToken = createAccessToken({
            id: history.rows[0].user_id,
            email: history.rows[0].email,
            auth_provider: 'email',
        });
    }
});

test.after(async () => {
    try {
        for (const sessionId of sessionIds) {
            try {
                await queryWithHardTimeout(
                    `UPDATE workout_sessions SET status = 'cancelled' WHERE id = $1 AND status = 'in_progress'`,
                    [sessionId],
                    8000
                );
            } catch (_) {}
        }
        for (const novaId of novaIds) {
            if (!userId) continue;
            try {
                await queryWithHardTimeout(
                    'DELETE FROM saved_workouts WHERE user_id = $1 AND workout_id = $2',
                    [userId, novaId],
                    8000
                );
            } catch (_) {}
            try {
                await queryWithHardTimeout(
                    'DELETE FROM user_workouts WHERE id = $1 AND user_id = $2',
                    [novaId, userId],
                    8000
                );
            } catch (_) {}
        }
    } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await closeDB().catch(() => {});
    }
});

function requireLive(t) {
    if (skipReason) {
        t.skip(skipReason);
        return false;
    }
    return true;
}

test('unauthenticated feedback routes stay locked', { timeout: TIMEOUT }, async (t) => {
    if (!base) {
        t.skip(skipReason || 'http server did not start');
        return;
    }
    const routes = [
        ['GET', '/api/home'],
        ['GET', '/api/activities'],
        ['GET', '/api/me/workouts'],
        ['POST', '/api/train/assist'],
    ];
    for (const [method, path] of routes) {
        const result = await jsonRequest(method, path, method === 'POST' ? { intent: 'create', q: '1km run' } : null);
        assert.equal(result.status, 401, path);
    }
});

test('unknown workout id returns 404 instead of 500', { timeout: TIMEOUT }, async (t) => {
    if (!requireLive(t)) return;
    const missing = await jsonRequest('GET', '/api/workouts/does-not-exist', null, token);
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'WORKOUT_NOT_FOUND');
});

test('home includes recentActivities for Flutter Recent Activity', { timeout: TIMEOUT }, async (t) => {
    if (!requireLive(t)) return;
    const result = await jsonRequest('GET', '/api/home', null, token);
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.json.recentActivities));
    assert.ok(result.json.state === 'NEW_ATHLETE' || result.json.state === 'NORMAL');
});

test('activity list and review feed Repeat + Favorites', { timeout: TIMEOUT }, async (t) => {
    if (!requireLive(t)) return;
    const list = await jsonRequest('GET', '/api/activities?limit=5', null, activityToken || token);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.json.activities));

    const missing = await jsonRequest(
        'GET',
        '/api/activities/00000000-0000-0000-0000-000000000000',
        null,
        activityToken || token
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error, 'ACTIVITY_NOT_FOUND');

    if (!existingActivityId) {
        t.skip('no completed activities to review');
        return;
    }
    const detail = await jsonRequest('GET', `/api/activities/${existingActivityId}`, null, activityToken);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.activityId, existingActivityId);
    assert.ok(Array.isArray(detail.json.splits));
    assert.equal(typeof detail.json.canRepeat, 'boolean');
    assert.equal(typeof detail.json.isSaved, 'boolean');
    if (detail.json.canRepeat) {
        assert.equal(detail.json.repeat.action, 'start');
        assert.ok(detail.json.repeat.workoutId);
        assert.equal(detail.json.repeat.path, '/api/workout-sessions/start');
    }
});

test('NOVA star create, edit, favorite, and start map to player APIs', { timeout: TIMEOUT }, async (t) => {
    if (!requireLive(t)) return;

    const empty = await jsonRequest('POST', '/api/train/assist', { intent: 'create', q: '' }, token);
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, 'NOVA_TEXT_REQUIRED');

    const unknown = await jsonRequest(
        'POST',
        '/api/train/assist',
        { intent: 'create', q: 'invent a secret race formula' },
        token
    );
    assert.equal(unknown.status, 400);
    assert.equal(unknown.json.error, 'NOVA_NO_EXERCISES');

    const created = await jsonRequest(
        'POST',
        '/api/train/assist',
        { intent: 'create', q: '30 min 1km run 20 wall balls sled push' },
        token
    );
    assert.equal(created.status, 200);
    assert.equal(created.json.intent, 'create');
    assert.equal(created.json.governance.aiMayInvent, false);
    assert.equal(created.json.workout.source, 'nova_text');
    assert.ok(created.json.workout.id);
    novaIds.push(created.json.workout.id);
    assert.deepEqual(
        created.json.workout.activities.map((item) => item.name),
        ['Running', 'Wall Balls', 'Sled Push']
    );

    const listed = await jsonRequest('GET', '/api/me/workouts', null, token);
    assert.equal(listed.status, 200);
    assert.ok(listed.json.workouts.some((item) => item.id === created.json.workout.id));

    const detail = await jsonRequest('GET', `/api/workouts/${created.json.workout.id}`, null, token);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.source, 'nova_text');

    const edited = await jsonRequest(
        'PATCH',
        `/api/me/workouts/${created.json.workout.id}`,
        { title: 'ITEST · hybrid', durationMin: 32 },
        token
    );
    assert.equal(edited.status, 200);
    assert.equal(edited.json.title, 'ITEST · hybrid');
    assert.equal(edited.json.durationMin, 32);

    const saved = await jsonRequest('POST', `/api/workouts/${created.json.workout.id}/save`, null, token);
    assert.equal(saved.status, 200);
    assert.equal(saved.json.isSaved, true);
    const favorites = await jsonRequest('GET', '/api/me/saved-workouts', null, token);
    assert.equal(favorites.status, 200);
    assert.ok(favorites.json.workouts.some((item) => item.id === created.json.workout.id));

    const active = await jsonRequest('GET', '/api/workout-sessions/active', null, token);
    assert.equal(active.status, 200);
    if (active.json.session?.sessionId) {
        const cancelled = await jsonRequest(
            'POST',
            `/api/workout-sessions/${active.json.session.sessionId}/cancel`,
            null,
            token
        );
        assert.equal(cancelled.status, 200);
    }

    const started = await jsonRequest(
        'POST',
        '/api/workout-sessions/start',
        { workoutId: created.json.workout.id, idempotencyKey: `itest-nova-${Date.now()}` },
        token
    );
    assert.equal(started.status, 200);
    assert.equal(started.json.workoutId, created.json.workout.id);
    assert.ok(started.json.sessionId);
    sessionIds.push(started.json.sessionId);
    assert.deepEqual(
        started.json.activities.map((item) => item.kind),
        ['run', 'roxzone', 'station', 'station']
    );

    const resume = await jsonRequest('GET', '/api/workout-sessions/active', null, token);
    assert.equal(resume.status, 200);
    assert.equal(resume.json.session.sessionId, started.json.sessionId);

    const stop = await jsonRequest('POST', `/api/workout-sessions/${started.json.sessionId}/cancel`, null, token);
    assert.equal(stop.status, 200);

    const recommend = await jsonRequest(
        'POST',
        '/api/train/assist',
        { intent: 'recommend', q: '30 min hyrox' },
        token
    );
    assert.equal(recommend.status, 200);
    assert.equal(recommend.json.intent, 'recommend');
    assert.ok(recommend.json.workouts.every((item) => !String(item.id).includes('-') || item.id.startsWith('wk_') || item.id.startsWith('HYR-')));
    assert.ok(recommend.json.workouts.every((item) => item.id !== created.json.workout.id));
});
