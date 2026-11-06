const test = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { connectDB, closeDB } = require('../../lib/db');
const { queryWithHardTimeout } = require('../../lib/dbQuery');
const { createAccessToken } = require('../../lib/token');
const app = require('../../server');

const TIMEOUT = 240000;
const ZERO = '00000000-0000-0000-0000-000000000000';

let server;
let base;
let token;
let userId;
let activityId;
let skipReason = null;
const created = { novaIds: [], sessionIds: [] };

async function call(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
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
    return { method, path, status: response.status, json };
}

function assertNoCrash(result) {
    const disabled = result.status === 503 && /not enabled/i.test(String(result.json?.message || ''));
    assert.ok(
        result.status < 500 || disabled,
        `${result.method} ${result.path} crashed ${result.status} ${result.json?.error || result.json?.message || ''}`
    );
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
        SELECT id FROM activities
        WHERE user_id = $1
        ORDER BY start_at DESC
        LIMIT 1
        `,
        [userId],
        8000
    );
    activityId = history.rows[0]?.id || null;
});

test.after(async () => {
    try {
        for (const sessionId of created.sessionIds) {
            try {
                await queryWithHardTimeout(
                    `UPDATE workout_sessions SET status = 'cancelled' WHERE id = $1 AND status = 'in_progress'`,
                    [sessionId],
                    8000
                );
            } catch (_) {}
        }
        for (const novaId of created.novaIds) {
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

test('public and auth routes do not crash', { timeout: TIMEOUT }, async (t) => {
    if (skipReason && !base) {
        t.skip(skipReason);
        return;
    }
    const saved = token;
    token = null;
    const results = await Promise.all([
        call('GET', '/'),
        call('GET', '/health'),
        call('GET', '/auth/me'),
        call('POST', '/auth/email-login', { email: 'not-an-account@example.com', password: 'x' }),
        call('POST', '/auth/forgot-password', { email: 'not-an-account@example.com' }),
        call('GET', '/api/integrations/garmin/webhook/activities'),
        call('GET', '/api/integrations/zepp/activity/webhook'),
        call('GET', '/api/home'),
    ]);
    token = saved;
    for (const result of results) assertNoCrash(result);
    assert.equal(results.find((item) => item.path === '/api/home').status, 401);
});

test('authenticated read APIs do not crash', { timeout: TIMEOUT }, async (t) => {
    if (skipReason) {
        t.skip(skipReason);
        return;
    }
    const paths = [
        '/api/home',
        '/api/categories',
        '/api/categories/cat_hybrid_race/workouts',
        '/api/categories/not_a_category/workouts',
        '/api/me/saved-workouts',
        '/api/me/workouts',
        '/api/train/overview',
        '/api/train/recommend?q=30%20min%20hyrox',
        '/api/train/alternatives?workoutId=wk_foundation_a',
        '/api/train/explain?workoutId=wk_foundation_a',
        '/api/train/alternatives?workoutId=wk_invented',
        '/api/workouts',
        '/api/workouts/wk_foundation_a',
        '/api/workouts/does-not-exist',
        '/api/activities',
        `/api/activities/${ZERO}`,
        '/api/workout-sessions/active',
        '/api/profile',
        '/api/profile/share',
        '/api/profile/export',
        '/api/notifications',
        '/api/athlete/dna',
        '/api/athlete/station-proficiency',
        '/api/arena',
        '/api/arena/leaderboard',
        '/api/arena/history',
        `/api/arena/history/${ZERO}`,
        `/api/arena/events/${ZERO}`,
        '/api/programs',
        '/api/programs/me',
        '/api/programs/unknown',
        '/api/plan/week',
        '/api/plan/missed',
        `/api/plan/missed/${ZERO}/suggestion`,
        '/api/readiness/checkin/today',
        '/api/performance/readiness',
        '/api/integrations',
        '/api/integrations/workouts',
        '/api/integrations/strava/status',
        '/api/integrations/strava/athlete',
        '/api/integrations/strava/activities',
        '/api/integrations/zepp/status',
        '/api/integrations/zepp/data',
        '/api/integrations/garmin/status',
        '/api/integrations/garmin/connect',
        '/api/integrations/zepp/connect',
        '/api/integrations/strava/connect',
        '/api/integrations/apple-health/status',
        '/api/integrations/samsung-health/status',
        '/api/integrations/samsung-health/samples',
        '/api/coaches',
        '/api/club/programs',
        '/api/club/home',
        '/api/coach/applications/me',
        '/api/coach/arena/events',
        '/api/admin/arena/events',
        '/api/admin/coach-applications',
        '/api/coach/club',
    ];
    if (activityId) paths.push(`/api/activities/${activityId}`);

    const results = [];
    for (const path of paths) {
        results.push(await call('GET', path));
    }
    const crashes = results.filter(
        (item) =>
            item.status >= 500 &&
            !(item.status === 503 && /not enabled/i.test(String(item.json?.message || '')))
    );
    assert.deepEqual(
        crashes.map((item) => `${item.status} ${item.path} ${item.json?.error || item.json?.message || ''}`),
        []
    );
});

test('authenticated write APIs do not crash and stay reversible', { timeout: TIMEOUT }, async (t) => {
    if (skipReason) {
        t.skip(skipReason);
        return;
    }

    const smokeToken = `smoke-fcm-${Date.now()}`;
    const writes = [
        await call('POST', '/api/train/assist', { intent: 'recommend', q: '30 min hyrox' }),
        await call('POST', '/api/train/assist', { intent: 'create', q: '' }),
        await call('POST', '/api/train/assist', { intent: 'create', q: 'invent a secret race' }),
        await call('POST', '/api/train/assist', {
            intent: 'create',
            activities: [{ kind: 'run', name: 'Secret invented HYROX move' }],
        }),
        await call('GET', '/api/train/explain?workoutId=wk_foundation_a'),
        await call('POST', '/api/readiness/checkin/dismiss', {}),
        await call('POST', '/api/workout-sessions/start', { workoutId: 'does-not-exist', idempotencyKey: `smoke-bad-${Date.now()}` }),
        await call('POST', `/api/workout-sessions/${ZERO}/complete`, { totalDurationSec: 10 }),
        await call('POST', `/api/workout-sessions/${ZERO}/cancel`, {}),
        await call('PATCH', `/api/workout-sessions/${ZERO}/progress`, { index: 0, kind: 'run', data: {} }),
        await call('POST', `/api/activities/${ZERO}/debrief`, { rpe: 5 }),
        await call('PATCH', `/api/me/workouts/${ZERO}`, { title: 'nope' }),
        await call('POST', '/api/workouts/wk_foundation_a/save'),
        await call('DELETE', '/api/workouts/wk_foundation_a/save'),
        await call('POST', '/api/notifications/device', {
            token: smokeToken,
            platform: 'android',
        }),
        await call('POST', '/api/notifications/read-all', {}),
        await call('POST', `/api/notifications/${ZERO}/read`, {}),
        await call('DELETE', '/api/notifications/device', { token: smokeToken }),
        await call('POST', '/auth/logout', {}),
    ];
    for (const result of writes) assertNoCrash(result);

    const createdNova = await call('POST', '/api/me/workouts', { q: '1km run 20 wall balls' });
    assertNoCrash(createdNova);
    if (createdNova.status < 300 && createdNova.json?.id) {
        created.novaIds.push(createdNova.json.id);
        const detail = await call('GET', `/api/workouts/${createdNova.json.id}`);
        assertNoCrash(detail);
        const edited = await call('PATCH', `/api/me/workouts/${createdNova.json.id}`, { title: 'SMOKE · hybrid' });
        assertNoCrash(edited);
        const saved = await call('POST', `/api/workouts/${createdNova.json.id}/save`);
        assertNoCrash(saved);
        const active = await call('GET', '/api/workout-sessions/active');
        assertNoCrash(active);
        if (active.json?.session?.sessionId) {
            assertNoCrash(await call('POST', `/api/workout-sessions/${active.json.session.sessionId}/cancel`));
        }
        const started = await call('POST', '/api/workout-sessions/start', {
            workoutId: createdNova.json.id,
            idempotencyKey: `smoke-nova-${Date.now()}`,
        });
        assertNoCrash(started);
        if (started.json?.sessionId) {
            created.sessionIds.push(started.json.sessionId);
            assertNoCrash(await call('GET', '/api/workout-sessions/active'));
            assertNoCrash(await call('POST', `/api/workout-sessions/${started.json.sessionId}/cancel`));
        }
    }
});
