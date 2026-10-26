const test = require('node:test');
const assert = require('node:assert/strict');
const xpConfig = require('../config/xp.json');
const programs = require('../data/programs.json');
const { getWorkout, assertProgramWorkouts } = require('../lib/workouts/workoutCatalog');
const { playerActivities, workActivities } = require('../lib/workout/playerPlan');
const {
    startSession,
    getActiveSession,
    saveProgress,
    completeSession,
} = require('../lib/workout/sessionService');
const { submitDebrief } = require('../lib/workout/debriefService');
const { buildHomeResponse } = require('../lib/home/homeState');

const DAY = '2026-10-26';
const STARTED = '2026-10-26T08:00:00.000Z';

function memoryWorkout() {
    const db = {
        sessions: [],
        progress: [],
        activities: [],
        splits: [],
        gps: [],
        xp: [],
        coins: [],
        streak: null,
        rewards: [],
        scheduled: [],
        debriefs: [],
        evidence: [],
        stations: [],
        imports: { zepp: [], strava: [], apple: [] },
    };

    const query = async (sql, params) => {
        if (sql.includes('workout:session_by_key')) {
            const row = db.sessions.find((session) => session.user_id === params[0] && session.idempotency_key === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:active_session')) {
            const rows = db.sessions.filter((session) => session.user_id === params[0] && session.status === 'in_progress');
            return { rows };
        }
        if (sql.includes('workout:scheduled_owner')) {
            const row = db.scheduled.find((session) => session.id === params[0] && session.user_id === params[1]);
            return { rows: row ? [row] : [] };
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
                result: null,
                activity_id: null,
            };
            db.sessions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('workout:session_by_workout')) {
            const row = db.sessions.find(
                (session) =>
                    session.user_id === params[0] &&
                    session.workout_id === params[1] &&
                    session.status === 'in_progress'
            );
            return { rows: row ? [{ id: row.id }] : [] };
        }
        if (sql.includes('workout:load_session') || sql.includes('workout:lock_session')) {
            const row = db.sessions.find((session) => session.id === params[0] && session.user_id === params[1]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:upsert_progress')) {
            const row = {
                id: params[0],
                session_id: params[1],
                activity_index: params[2],
                kind: params[3],
                data: JSON.parse(params[4]),
                completed_at: params[5],
            };
            const index = db.progress.findIndex(
                (item) => item.session_id === row.session_id && item.activity_index === row.activity_index
            );
            if (index >= 0) db.progress[index] = row;
            else db.progress.push(row);
            return { rows: [] };
        }
        if (sql.includes('workout:load_progress')) {
            return {
                rows: db.progress
                    .filter((item) => item.session_id === params[0])
                    .sort((left, right) => left.activity_index - right.activity_index),
            };
        }
        if (sql.includes('workout:cancel_session')) {
            const row = db.sessions.find((session) => session.id === params[0] && session.user_id === params[1]);
            if (row && row.status === 'in_progress') row.status = 'cancelled';
            return { rows: [] };
        }
        if (sql.includes('workout:import_zepp')) return { rows: db.imports.zepp };
        if (sql.includes('workout:import_strava')) return { rows: db.imports.strava };
        if (sql.includes('workout:import_apple')) return { rows: db.imports.apple };
        if (sql.includes('workout:sum_xp')) {
            const xp = db.xp.filter((row) => row.user_id === params[0]).reduce((sum, row) => sum + row.xp, 0);
            return { rows: [{ xp }] };
        }
        if (sql.includes('workout:count_today')) {
            const count = db.sessions.filter(
                (session) =>
                    session.user_id === params[0] &&
                    session.local_date === params[1] &&
                    (session.status === 'completed' || session.status === 'partial') &&
                    session.id !== params[2]
            ).length;
            return { rows: [{ count }] };
        }
        if (sql.includes('workout:count_completed')) {
            const count = db.sessions.filter(
                (session) =>
                    session.user_id === params[0] &&
                    (session.status === 'completed' || session.status === 'partial') &&
                    session.id !== params[1]
            ).length;
            return { rows: [{ count }] };
        }
        if (sql.includes('workout:load_streak')) {
            return { rows: db.streak ? [db.streak] : [] };
        }
        if (sql.includes('workout:load_badges')) {
            return { rows: db.rewards.filter((row) => row.user_id === params[0] && row.kind === 'BADGE') };
        }
        if (sql.includes('workout:today_plan')) {
            return {
                rows: db.scheduled.filter((session) => session.user_id === params[0] && session.scheduled_on === params[1]),
            };
        }
        if (sql.includes('workout:insert_activity')) {
            db.activities.push({
                id: params[0],
                user_id: params[1],
                source: 'ROXCLUB_NATIVE',
                sources: JSON.parse(params[2]),
                provenance: JSON.parse(params[3]),
                workout_id: params[4],
                activity_type: params[5],
                name: params[6],
                start_at: params[7],
                end_at: params[8],
                duration_sec: params[9],
                distance_m: params[10],
                avg_hr: params[11],
                max_hr: params[12],
                evidence_status: params[13],
                roxzone_total_sec: params[14],
                session_id: params[15],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_split')) {
            db.splits.push({
                id: params[0],
                activity_id: params[1],
                activity_index: params[2],
                kind: params[3],
                name: params[4],
                duration_sec: params[5],
                distance_m: params[6],
                reps: params[7],
                load_kg: params[8],
                pace_sec_per_km: params[9],
                split_sec_per_500m: params[10],
                rep_rate: params[11],
                avg_hr: params[12],
                input_method: params[13],
                data: JSON.parse(params[14]),
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_gps')) {
            db.gps.push({
                activity_id: params[0],
                seq: params[1],
                lat: params[2],
                lng: params[3],
                ts: params[4],
                altitude: params[5],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_xp')) {
            db.xp.push({
                user_id: params[0],
                xp: params[1],
                reason: params[2],
                activity_id: params[3],
                calc_version: params[4],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_coins')) {
            db.coins.push({ user_id: params[0], coins: params[1], reason: params[2], activity_id: params[3] });
            return { rows: [] };
        }
        if (sql.includes('workout:upsert_streak')) {
            db.streak = { user_id: params[0], current_streak: params[1], last_active_on: params[2] };
            return { rows: [] };
        }
        if (sql.includes('workout:insert_reward')) {
            const row = { user_id: params[0], activity_id: params[1], kind: params[2], code: params[3] };
            if (!db.rewards.some((item) => item.user_id === row.user_id && item.kind === row.kind && item.code === row.code)) {
                db.rewards.push(row);
            }
            return { rows: [] };
        }
        if (sql.includes('workout:update_scheduled')) {
            const row = db.scheduled.find((session) => session.id === params[0] && session.user_id === params[1]);
            if (row) {
                row.status = params[2];
                row.completed_at = params[3];
            }
            return { rows: [] };
        }
        if (sql.includes('workout:finish_session')) {
            const row = db.sessions.find((session) => session.id === params[0] && session.user_id === params[1]);
            row.status = params[2];
            row.ended_at = params[3];
            row.total_duration_sec = params[4];
            row.paused_duration_sec = params[5];
            row.activity_id = params[6];
            row.local_date = row.local_date || params[7];
            row.result = JSON.parse(params[8]);
            if (params[9]) row.scheduled_session_id = params[9];
            return { rows: [] };
        }
        if (sql.includes('workout:evidence_splits')) {
            return { rows: db.splits.filter((split) => split.activity_id === params[0]) };
        }
        if (sql.includes('workout:insert_dna_evidence')) {
            db.evidence.push({ activity_id: params[0], activity_index: params[1], kind: params[2], name: params[3] });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_station_evidence')) {
            db.stations.push({ activity_id: params[0], activity_index: params[1], name: params[2] });
            return { rows: [] };
        }
        if (sql.includes('workout:load_activity_owner')) {
            const row = db.activities.find((activity) => activity.id === params[0]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('workout:upsert_debrief')) {
            const row = {
                activity_id: params[0],
                user_id: params[1],
                rpe: params[2],
                flags: params[3],
                notes: params[4],
                created_at: STARTED,
            };
            const index = db.debriefs.findIndex((item) => item.activity_id === row.activity_id);
            if (index >= 0) db.debriefs[index] = row;
            else db.debriefs.push(row);
            return { rows: [row] };
        }
        throw new Error(`unexpected sql: ${sql.trim().slice(0, 80)}`);
    };

    db.query = query;
    return db;
}

function opts(db, enqueue, localDate = DAY) {
    return { query: db.query, localDate, enqueueReadinessRecompute: enqueue };
}

function activityEntry(activity, data) {
    return { activityIndex: activity.activityIndex, kind: activity.kind, data };
}

function hybridEntries(plan, { gps = false } = {}) {
    return plan.map((activity) => {
        if (activity.kind === 'run') {
            return activityEntry(activity, {
                durationSec: 300,
                distanceM: 1000,
                inputMethod: gps ? 'gps' : 'manual',
                avgPaceSecPerKm: 300,
                ...(gps
                    ? {
                          kmSplits: [{ km: 1, sec: 300 }],
                          gpsPoints: [
                              { lat: 24.86, lng: 67.01, ts: STARTED },
                              { lat: 24.87, lng: 67.02, ts: '2026-10-26T08:05:00.000Z', altitude: 12 },
                          ],
                      }
                    : {}),
            });
        }
        if (activity.kind === 'roxzone') {
            return activityEntry(activity, { durationSec: 30, targetSec: 30 });
        }
        return activityEntry(activity, {
            durationSec: 90,
            inputMethod: 'tap',
            reps: activity.target?.reps || null,
            distanceM: activity.target?.distanceM,
            loadKg: activity.target?.loadKg,
        });
    });
}

async function start(db, workoutId, key, enqueue, extra = {}) {
    return startSession('user-1', { workoutId, idempotencyKey: key, startedAt: extra.startedAt || STARTED, ...extra }, opts(db, enqueue, extra.localDate || DAY));
}

test('hybrid full stores roxzone separately from the 8 activities', async () => {
    const db = memoryWorkout();
    db.scheduled.push({
        id: 'plan-full',
        user_id: 'user-1',
        workout_id: 'wk_foundation_a',
        scheduled_on: DAY,
        status: 'pending',
        completed_at: null,
    });
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_foundation_a'));
    assert.equal(workActivities(plan).length, 8);
    assert.equal(plan[1].kind, 'roxzone');

    const started = await start(db, 'wk_foundation_a', 'full', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: '2026-10-26T08:45:00.000Z',
            totalDurationSec: 2700,
            pausedDurationSec: 10,
            completedActivities: hybridEntries(plan),
        },
        opts(db, enqueue)
    );

    assert.equal(done.completedCount, 8);
    assert.equal(done.totalCount, 8);
    assert.equal(done.roxzoneTotalSec, 30);
    assert.equal(done.workoutTitle, 'Foundation Protocol A');
    const roxzone = done.splits.find((split) => split.name === 'Roxzone');
    assert.equal(roxzone.durationSec, 30);
    const stationTime = done.splits
        .filter((split) => split.name !== 'Roxzone' && split.name !== 'Running')
        .reduce((sum, split) => sum + split.durationSec, 0);
    assert.equal(stationTime, 90 * 7);
    assert.equal(done.totalXp, xpConfig.sessionBaseXp + 8 * xpConfig.activityXp);
    assert.equal(db.stations.length, 7);
    assert.equal(db.evidence.length, 9);
    assert.equal(db.scheduled[0].status, 'replaced');
});

test('ending a hybrid early pays XP only for the finished activities', async () => {
    const db = memoryWorkout();
    db.scheduled.push({
        id: 'plan-partial',
        user_id: 'user-1',
        workout_id: 'wk_foundation_a',
        scheduled_on: DAY,
        status: 'pending',
        completed_at: null,
    });
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_foundation_a'));
    const started = await start(db, 'wk_foundation_a', 'partial', enqueue, { scheduledSessionId: 'plan-partial' });
    const early = hybridEntries(plan).filter((entry) => entry.activityIndex <= 3);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        { endedAt: STARTED, totalDurationSec: 600, isPartial: true, completedActivities: early },
        opts(db, enqueue)
    );

    assert.equal(done.completedCount, 3);
    assert.equal(done.totalCount, 8);
    assert.equal(done.totalXp, 3 * xpConfig.activityXp);
    assert.equal(done.xpBreakdown.some((row) => row.reason === 'session_base'), false);
    assert.equal(db.sessions[0].status, 'partial');
    assert.equal(db.scheduled[0].status, 'partial');
});

test('outdoor GPS run keeps splits and a treadmill run is LIMITED', async () => {
    const outdoor = memoryWorkout();
    const enqueue = () => {};
    const run = playerActivities(getWorkout('wk_zone2_run'));
    const started = await start(outdoor, 'wk_zone2_run', 'gps', enqueue);
    const gps = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: '2026-10-26T08:40:00.000Z',
            totalDurationSec: 2400,
            completedActivities: [
                activityEntry(run[0], {
                    durationSec: 2400,
                    distanceM: 5000,
                    inputMethod: 'gps',
                    kmSplits: [{ km: 1, sec: 480 }],
                    gpsPoints: [
                        { lat: 24.8, lng: 67.0, ts: STARTED },
                        { lat: 24.81, lng: 67.01, ts: '2026-10-26T08:10:00.000Z' },
                    ],
                }),
            ],
        },
        opts(outdoor, enqueue)
    );
    assert.equal(gps.evidenceStatus, 'STANDARD');
    assert.equal(outdoor.gps.length, 2);
    assert.deepEqual(outdoor.splits[0].data.kmSplits, [{ km: 1, sec: 480 }]);

    const treadmill = memoryWorkout();
    const manualStart = await start(treadmill, 'wk_zone2_run', 'manual', enqueue);
    const manual = await completeSession(
        'user-1',
        manualStart.sessionId,
        {
            endedAt: STARTED,
            totalDurationSec: 1800,
            completedActivities: [
                activityEntry(run[0], { durationSec: 1800, distanceM: 4000, inputMethod: 'manual' }),
            ],
        },
        opts(treadmill, enqueue)
    );
    assert.equal(manual.evidenceStatus, 'LIMITED');
    assert.equal(treadmill.splits[0].input_method, 'manual');
    assert.equal(treadmill.splits[0].distance_m, 4000);
});

test('detailed strength stores each set', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_strength_01'));
    const started = await start(db, 'wk_strength_01', 'sets', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: STARTED,
            totalDurationSec: 900,
            isPartial: true,
            completedActivities: [
                activityEntry(plan[0], {
                    mode: 'detailed',
                    sets: [
                        { setNo: 1, kg: 60, reps: 8, rpe: 7, restSec: 90 },
                        { setNo: 2, kg: 60, reps: 8, rpe: 8, restSec: 90 },
                    ],
                }),
            ],
        },
        opts(db, enqueue)
    );
    assert.equal(done.completedCount, 1);
    assert.equal(db.splits[0].data.mode, 'detailed');
    assert.equal(db.splits[0].data.sets.length, 2);
    assert.equal(db.splits[0].data.sets[1].kg, 60);
});

test('recovery earns 0 XP and coins, and keeps the streak alive', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const runPlan = playerActivities(getWorkout('wk_zone2_run'));
    const first = await start(db, 'wk_zone2_run', 'day-1', enqueue, { localDate: '2026-10-25', startedAt: '2026-10-25T08:00:00.000Z' });
    await completeSession(
        'user-1',
        first.sessionId,
        {
            endedAt: '2026-10-25T08:40:00.000Z',
            totalDurationSec: 2400,
            completedActivities: [activityEntry(runPlan[0], { durationSec: 2400, distanceM: 5000, inputMethod: 'gps' })],
        },
        opts(db, enqueue, '2026-10-25')
    );
    assert.equal(db.streak.current_streak, 1);

    const recoveryPlan = playerActivities(getWorkout('wk_recovery_01'));
    const second = await start(db, 'wk_recovery_01', 'day-2', enqueue, {
        localDate: '2026-10-26',
        startedAt: '2026-10-26T08:00:00.000Z',
    });
    const done = await completeSession(
        'user-1',
        second.sessionId,
        {
            endedAt: '2026-10-26T08:20:00.000Z',
            totalDurationSec: 900,
            completedActivities: recoveryPlan.map((activity) =>
                activityEntry(activity, { durationSec: activity.target.durationSec })
            ),
        },
        opts(db, enqueue, '2026-10-26')
    );

    assert.equal(done.totalXp, 0);
    assert.equal(done.coinsEarned, xpConfig.recoveryCoins);
    assert.equal(done.streak, 2);
    assert.equal(db.xp.length, 2);
    assert.equal(db.coins.filter((row) => row.reason === 'recovery').length, 1);
});

test('the second session on the same local day gets reduced XP', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_zone2_run'));
    const runData = [activityEntry(plan[0], { durationSec: 2400, distanceM: 5000, inputMethod: 'gps' })];
    const firstStart = await start(db, 'wk_zone2_run', 'one', enqueue);
    const first = await completeSession(
        'user-1',
        firstStart.sessionId,
        { endedAt: STARTED, totalDurationSec: 2400, completedActivities: runData },
        opts(db, enqueue)
    );
    const secondStart = await start(db, 'wk_zone2_run', 'two', enqueue);
    const second = await completeSession(
        'user-1',
        secondStart.sessionId,
        { endedAt: STARTED, totalDurationSec: 2400, completedActivities: runData },
        opts(db, enqueue)
    );

    assert.equal(first.totalXp, xpConfig.sessionBaseXp + xpConfig.activityXp);
    assert.equal(
        second.totalXp,
        Math.round(xpConfig.sessionBaseXp * xpConfig.dailyMultipliers[1]) +
            Math.round(xpConfig.activityXp * xpConfig.dailyMultipliers[1])
    );
    assert.ok(second.totalXp < first.totalXp);
});

test('a duplicate complete does not write XP twice', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_zone2_run'));
    const started = await start(db, 'wk_zone2_run', 'once', enqueue);
    const body = {
        endedAt: STARTED,
        totalDurationSec: 2400,
        completedActivities: [activityEntry(plan[0], { durationSec: 2400, distanceM: 5000, inputMethod: 'gps' })],
    };
    const first = await completeSession('user-1', started.sessionId, body, opts(db, enqueue));
    const xpCount = db.xp.length;
    const second = await completeSession('user-1', started.sessionId, body, opts(db, enqueue));
    assert.deepEqual(second, first);
    assert.equal(db.xp.length, xpCount);
    assert.equal(db.activities.length, 1);
});

test('GET active resumes the saved station after a crash', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const started = await start(db, 'wk_foundation_a', 'resume', enqueue);
    await saveProgress(
        'user-1',
        started.sessionId,
        activityEntry(started.activities[2], { durationSec: 70, inputMethod: 'tap', reps: 20 }),
        opts(db, enqueue)
    );
    const active = await getActiveSession('user-1', opts(db, enqueue));
    assert.equal(active.session.sessionId, started.sessionId);
    assert.equal(active.session.progress.length, 1);
    assert.equal(active.session.progress[0].activityIndex, 2);
    assert.equal(active.session.progress[0].data.reps, 20);
});

test('starting a second session while one is in progress returns 409', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const first = await start(db, 'wk_zone2_run', 'open', enqueue);
    await assert.rejects(
        () => start(db, 'wk_zone2_run', 'other', enqueue),
        (error) => {
            assert.equal(error.code, 'SESSION_IN_PROGRESS');
            assert.equal(error.status, 409);
            assert.equal(error.sessionId, first.sessionId);
            return true;
        }
    );
});

test('crossing a level threshold returns a LEVEL_UP reward', async () => {
    const db = memoryWorkout();
    db.xp.push({ user_id: 'user-1', xp: 450, reason: 'seed', activity_id: null, calc_version: 'v0' });
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_zone2_run'));
    const started = await start(db, 'wk_zone2_run', 'level', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: STARTED,
            totalDurationSec: 2400,
            completedActivities: [activityEntry(plan[0], { durationSec: 2400, distanceM: 5000, inputMethod: 'gps' })],
        },
        opts(db, enqueue)
    );
    assert.equal(done.levelBefore, 1);
    assert.equal(done.levelAfter, 2);
    assert.equal(done.xpIntoLevel, 10);
    assert.ok(done.rewards.some((reward) => reward.type === 'LEVEL_UP' && reward.level === 2));
    assert.ok(done.rewards.some((reward) => reward.type === 'BADGE' && reward.id === 'first_workout'));
});

test('a native session merges with a Zepp import and keeps the watch heart rate', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    db.imports.zepp.push({
        source: 'zepp',
        external_id: 'zepp-1',
        activity_type: 'hybrid',
        start_at: STARTED,
        duration_seconds: 1200,
        average_heartrate: 150,
    });
    const plan = playerActivities(getWorkout('wk_foundation_a'));
    const started = await start(db, 'wk_foundation_a', 'merge', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: '2026-10-26T08:20:00.000Z',
            totalDurationSec: 1200,
            isPartial: true,
            completedActivities: [hybridEntries(plan)[0]],
        },
        opts(db, enqueue)
    );

    assert.equal(db.activities.length, 1);
    assert.deepEqual(db.activities[0].sources, ['ROXCLUB_NATIVE', 'zepp']);
    assert.equal(db.activities[0].avg_hr, 150);
    assert.equal(done.avgHr, 150);
    assert.equal(done.evidenceStatus, 'VERIFIED');
    assert.equal(db.splits[0].name, 'Running');
});

test('complete and debrief both recompute readiness', async () => {
    const db = memoryWorkout();
    const calls = [];
    const enqueue = (userId) => calls.push(userId);
    const plan = playerActivities(getWorkout('wk_zone2_run'));
    const started = await start(db, 'wk_zone2_run', 'debrief', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: STARTED,
            totalDurationSec: 2400,
            completedActivities: [activityEntry(plan[0], { durationSec: 2400, distanceM: 5000, inputMethod: 'gps' })],
        },
        opts(db, enqueue)
    );
    await submitDebrief('user-1', done.activityId, { rpe: 7, flags: ['soreness'], notes: 'tight calves' }, opts(db, enqueue));
    assert.deepEqual(calls, ['user-1', 'user-1']);
    assert.equal(db.debriefs[0].rpe, 7);
    assert.deepEqual(db.debriefs[0].flags, ['soreness']);
});

test('progress accepts the workout id of the open session', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const started = await start(db, 'wk_foundation_a', 'by-workout', enqueue);
    const saved = await saveProgress(
        'user-1',
        'wk_foundation_a',
        activityEntry(started.activities[2], { durationSec: 70, inputMethod: 'tap', reps: 20 }),
        opts(db, enqueue)
    );
    assert.equal(saved.sessionId, started.sessionId);
    assert.equal(saved.saved, true);
    assert.equal(db.progress[0].session_id, started.sessionId);
});

test('progress with the wrong kind for that index is rejected', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const started = await start(db, 'wk_foundation_a', 'bad-kind', enqueue);
    await assert.rejects(
        () =>
            saveProgress(
                'user-1',
                started.sessionId,
                { activityIndex: 0, kind: 'station', data: { durationSec: 30, inputMethod: 'tap' } },
                opts(db, enqueue)
            ),
        (error) => {
            assert.equal(error.status, 400);
            assert.equal(error.code, 'INVALID_PROGRESS');
            return true;
        }
    );
    assert.equal(db.progress.length, 0);
});

test('a different workout type than planned still earns normal XP and is not replaced', async () => {
    const db = memoryWorkout();
    db.scheduled.push({
        id: 'plan-1',
        user_id: 'user-1',
        workout_id: 'wk_zone2_run',
        scheduled_on: DAY,
        status: 'pending',
        completed_at: null,
    });
    const enqueue = () => {};
    const plan = playerActivities(getWorkout('wk_strength_01'));
    const started = await start(db, 'wk_strength_01', 'swap', enqueue);
    const done = await completeSession(
        'user-1',
        started.sessionId,
        {
            endedAt: STARTED,
            totalDurationSec: 1800,
            completedActivities: plan.map((activity) =>
                activityEntry(activity, { mode: 'simple', durationSec: 600 })
            ),
        },
        opts(db, enqueue)
    );
    assert.equal(done.totalXp, xpConfig.sessionBaseXp + plan.length * xpConfig.activityXp);
    assert.equal(db.scheduled[0].status, 'pending');
});

test('roxzone display counting shows Wall Balls as Activity 2 of 8', async () => {
    const db = memoryWorkout();
    const enqueue = () => {};
    const started = await start(db, 'wk_foundation_a', 'display', enqueue);
    const wallBalls = started.activities.find((activity) => activity.name === 'Wall Balls');
    assert.equal(wallBalls.kind, 'station');
    assert.equal(wallBalls.index, 2);
    assert.equal(wallBalls.displayIndex, 2);
    assert.equal(wallBalls.displayTotal, 8);
    assert.equal(started.activities.filter((activity) => activity.kind === 'roxzone').length, 1);

    const active = await getActiveSession('user-1', opts(db, enqueue));
    assert.deepEqual(active.session.activities, started.activities);

    const alternating = playerActivities(getWorkout('wk_hybrid_01'));
    const kinds = alternating.map((activity) => activity.kind);
    assert.deepEqual(kinds, ['run', 'roxzone', 'station', 'roxzone', 'run', 'roxzone', 'station']);

    const disabled = playerActivities({
        type: 'hybrid',
        autoRoxzone: false,
        activities: getWorkout('wk_hybrid_01').activities,
    });
    assert.equal(disabled.some((activity) => activity.kind === 'roxzone'), false);

    await saveProgress(
        'user-1',
        started.sessionId,
        { index: wallBalls.index, kind: 'station', data: { durationSec: 70, inputMethod: 'tap', reps: 20 } },
        opts(db, enqueue)
    );
    const resumed = await getActiveSession('user-1', opts(db, enqueue));
    assert.equal(resumed.session.progress[0].activityIndex, wallBalls.index);
});

test('debrief calls enqueueReadinessRecompute', async () => {
    const db = memoryWorkout();
    db.activities.push({ id: 'act-1', user_id: 'user-1' });
    const calls = [];
    await submitDebrief(
        'user-1',
        'act-1',
        { rpe: 6, flags: ['low_energy'] },
        { query: db.query, enqueueReadinessRecompute: (userId) => calls.push(userId) }
    );
    assert.deepEqual(calls, ['user-1']);
});

test('home shows done, partial, and replaced on today workout', () => {
    for (const status of ['done', 'partial', 'replaced']) {
        const home = buildHomeResponse({
            name: 'Alex',
            completedSessions: 3,
            xpTotal: 0,
            todaySession: {
                workout_id: 'wk_foundation_a',
                title: 'Foundation Protocol A',
                duration_min: 45,
                scheduled_on: DAY,
                plan_day: '1',
                week_number: 1,
                status,
            },
        });
        assert.equal(home.todayWorkout.status, status);
        assert.equal(home.state, 'NORMAL');
    }
});

test('every program week 1 day 1 can be started', async () => {
    for (const program of Object.values(programs.programs)) {
        const workoutId = program.weeks[0].days[0].workoutId;
        const db = memoryWorkout();
        const started = await startSession(
            'user-1',
            { workoutId, idempotencyKey: `week1-${workoutId}` },
            { query: db.query, localDate: DAY }
        );
        assert.equal(started.workoutId, workoutId);
        assert.equal(started.status, 'in_progress');
        assert.ok(started.activities.length > 0);
    }
});

test('startup fails when a program references an unknown workout', () => {
    assert.throws(
        () => assertProgramWorkouts(new Set(['wk_foundation_a']), programs),
        (error) => {
            assert.equal(error.code, 'UNKNOWN_PROGRAM_WORKOUTS');
            assert.ok(error.missing.includes('wk_general_a'));
            assert.match(error.message, /wk_general_a/);
            return true;
        }
    );
});
