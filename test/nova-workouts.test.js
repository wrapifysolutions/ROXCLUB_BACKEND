const test = require('node:test');
const assert = require('node:assert/strict');

const { parseNovaText } = require('../lib/workouts/novaParse');
const { createUserWorkout, updateUserWorkout, listUserWorkouts } = require('../lib/workouts/userWorkoutService');
const { getTrainAssist } = require('../lib/workouts/trainAssist');
const { startSession } = require('../lib/workout/sessionService');
const { getActivityDetail } = require('../lib/workout/activityHistory');
const { buildHomeResponse } = require('../lib/home/homeState');

function memoryNova() {
    const db = { workouts: [], sessions: [], activities: [], splits: [] };
    const query = async (sql, params = []) => {
        if (/CREATE TABLE|CREATE INDEX/i.test(sql)) return { rows: [] };
        if (sql.includes('nova:insert_user_workout')) {
            db.workouts.push({
                id: params[0],
                user_id: params[1],
                title: params[2],
                category_id: params[3],
                type: params[4],
                duration_min: params[5],
                difficulty: params[6],
                source: params[7],
                purpose: params[8],
                activities: JSON.parse(params[9]),
                updated_at: new Date().toISOString(),
            });
            return { rows: [] };
        }
        if (sql.includes('nova:load_user_workout')) {
            const row = db.workouts.find((item) => item.id === params[0] && item.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('nova:update_user_workout')) {
            const row = db.workouts.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (row) {
                row.title = params[2];
                row.category_id = params[3];
                row.type = params[4];
                row.duration_min = params[5];
                row.difficulty = params[6];
                row.purpose = params[7];
                row.activities = JSON.parse(params[8]);
                row.updated_at = new Date().toISOString();
            }
            return { rows: [] };
        }
        if (sql.includes('nova:list_user_workouts')) {
            return {
                rows: db.workouts
                    .filter((item) => item.user_id === params[0])
                    .sort((left, right) => String(right.updated_at).localeCompare(String(left.updated_at))),
            };
        }
        if (sql.includes('workout:session_by_key')) {
            const row = db.sessions.find((item) => item.user_id === params[0] && item.idempotency_key === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:active_session')) {
            return { rows: db.sessions.filter((item) => item.user_id === params[0] && item.status === 'in_progress') };
        }
        if (sql.includes('workout:insert_session')) {
            const row = {
                id: params[0],
                user_id: params[1],
                workout_id: params[2],
                scheduled_session_id: params[3],
                status: 'in_progress',
                started_at: params[4],
                idempotency_key: params[5],
                local_date: params[6],
                paused_duration_sec: 0,
                result: null,
            };
            db.sessions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('workout:activity_detail_splits')) {
            return {
                rows: db.splits
                    .filter((item) => item.activity_id === params[0])
                    .sort((left, right) => left.activity_index - right.activity_index),
            };
        }
        if (sql.includes('workout:activity_detail')) {
            const row = db.activities.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (!row) return { rows: [] };
            const session = db.sessions.find((item) => item.id === row.session_id);
            return {
                rows: [
                    {
                        ...row,
                        result: session?.result || { totalXp: 80, coinsEarned: 10, subtitle: 'NOVA session' },
                        session_status: session?.status || 'completed',
                    },
                ],
            };
        }
        return { rows: [] };
    };
    return { db, query };
}

test('NOVA text parser maps known RoxClub moves and rejects invented ones', () => {
    const parsed = parseNovaText('40 min hybrid 1km run sled push 20 wall balls 3x10 squats');
    assert.equal(parsed.type, 'hybrid');
    assert.equal(parsed.source, 'nova_text');
    assert.equal(parsed.showInLibrary, false);
    assert.equal(parsed.durationMin, 40);
    assert.deepEqual(
        parsed.activities.map((item) => item.name),
        ['Running', 'Sled Push', 'Wall Balls', 'Squat']
    );
    assert.equal(parsed.activities.find((item) => item.name === 'Running').target.distanceM, 1000);
    assert.equal(parsed.activities.find((item) => item.name === 'Wall Balls').target.reps, 20);
    assert.equal(parsed.activities.find((item) => item.name === 'Squat').target.sets, 3);
    assert.equal(parsed.activities.find((item) => item.name === 'Squat').target.reps, 10);

    assert.throws(() => parseNovaText(''), (error) => error.code === 'NOVA_TEXT_REQUIRED');
    assert.throws(() => parseNovaText('invent a secret HYROX race formula'), (error) => error.code === 'NOVA_NO_EXERCISES');
});

test('user-authored NOVA workout can be created, edited, listed, and started', async () => {
    const { query } = memoryNova();
    const created = await createUserWorkout(
        'user-nova',
        { q: '30 min 1km run 20 wall balls sled push' },
        query
    );
    assert.ok(created.id);
    assert.equal(created.source, 'nova_text');
    assert.equal(created.showInLibrary, false);
    assert.ok(created.activities.some((item) => item.name === 'Wall Balls'));

    const updated = await updateUserWorkout(
        'user-nova',
        created.id,
        { title: 'My NOVA hybrid', durationMin: 35 },
        query
    );
    assert.equal(updated.title, 'My NOVA hybrid');
    assert.equal(updated.durationMin, 35);

    const listed = await listUserWorkouts('user-nova', query);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, created.id);

    const started = await startSession(
        'user-nova',
        { workoutId: created.id, idempotencyKey: 'nova-start-1' },
        { query }
    );
    assert.equal(started.workoutId, created.id);
    assert.equal(started.status, 'in_progress');
    assert.ok(started.activities.some((item) => item.name === 'Wall Balls'));
});

test('star assist create persists a user-authored workout, not a library invention', async () => {
    const { query } = memoryNova();
    const result = await getTrainAssist(
        'user-nova-2',
        { intent: 'create', q: 'create 25 min ski erg 1km run farmers carry' },
        { daily: { status: 'READY', score: 70 }, query }
    );
    assert.equal(result.intent, 'create');
    assert.equal(result.governance.aiMayInvent, false);
    assert.equal(result.governance.source, 'user_authored_nova');
    assert.ok(result.workout.id);
    assert.equal(result.workout.source, 'nova_text');
    assert.match(result.explanation, /No official library workout was invented/);
});

test('activity detail returns review, favorite, and repeat payload', async () => {
    const { db, query } = memoryNova();
    db.activities.push({
        id: '11111111-1111-1111-1111-111111111111',
        user_id: 'user-nova',
        session_id: 'sess-1',
        workout_id: 'wk_foundation_a',
        name: 'Foundation Protocol A',
        activity_type: 'hybrid',
        start_at: '2026-11-05T08:00:00.000Z',
        end_at: '2026-11-05T08:45:00.000Z',
        duration_sec: 2700,
        distance_m: 4000,
        avg_hr: 148,
        evidence_status: 'VERIFIED',
        roxzone_total_sec: 180,
        sources: ['ROXCLUB_NATIVE'],
    });
    db.sessions.push({
        id: 'sess-1',
        user_id: 'user-nova',
        workout_id: 'wk_foundation_a',
        status: 'completed',
        result: { totalXp: 80, coinsEarned: 10, completedCount: 8, totalCount: 8, subtitle: 'Done' },
    });
    db.splits.push({
        activity_id: '11111111-1111-1111-1111-111111111111',
        activity_index: 0,
        kind: 'run',
        name: 'Running',
        duration_sec: 300,
        distance_m: 1000,
        reps: null,
        load_kg: null,
        pace_sec_per_km: 300,
        avg_hr: 140,
        input_method: 'gps',
        data: {},
    });

    const detail = await getActivityDetail('user-nova', '11111111-1111-1111-1111-111111111111', { query });
    assert.equal(detail.activityId, '11111111-1111-1111-1111-111111111111');
    assert.equal(detail.workoutId, 'wk_foundation_a');
    assert.equal(detail.canRepeat, true);
    assert.deepEqual(detail.repeat, {
        action: 'start',
        workoutId: 'wk_foundation_a',
        path: '/api/workout-sessions/start',
    });
    assert.equal(detail.isSaved, false);
    assert.equal(detail.splits.length, 1);
    assert.equal(detail.splits[0].name, 'Running');
    assert.equal(detail.result.totalXp, 80);
});

test('home includes recentActivities for new and normal athletes', () => {
    const recent = [
        {
            activityId: 'act-1',
            title: 'Foundation Protocol A',
            workoutId: 'wk_foundation_a',
            durationSec: 2700,
        },
    ];
    const newbie = buildHomeResponse({
        name: 'Alex',
        completedSessions: 0,
        recentActivities: recent,
    });
    assert.equal(newbie.state, 'NEW_ATHLETE');
    assert.deepEqual(newbie.recentActivities, recent);

    const normal = buildHomeResponse({
        name: 'Alex',
        completedSessions: 3,
        recentActivities: recent,
    });
    assert.equal(normal.state, 'NORMAL');
    assert.deepEqual(normal.recentActivities, recent);
});
