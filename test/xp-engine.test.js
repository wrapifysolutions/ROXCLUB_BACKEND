const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildXp,
    totalXpOf,
    dailyMultiplier,
    durationXp,
    intensityFactor,
    levelState,
    xpConfig,
} = require('../lib/workout/xpService');
const { insertXpRows, reverseActivityXp, loadSeasonalPoints, currentSeasonKey } = require('../lib/workout/xpLedger');
const { invalidateActivity, editActivity } = require('../lib/workout/activityLifecycle');

function memory() {
    const db = { xp: [], seasonal: [], activities: [] };
    const query = async (sql, params = []) => {
        if (sql.includes('workout:insert_xp') || sql.includes('engine:import_xp')) {
            db.xp.push({
                user_id: params[0],
                xp: params[1],
                reason: params[2],
                activity_id: params[3],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_seasonal') || sql.includes('workout:reverse_seasonal')) {
            db.seasonal.push({
                user_id: params[0],
                season_key: params[1],
                points: params[2],
                reason: params[3],
                activity_id: params[4],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:load_xp_for_activity') || sql.includes('workout:xp_revision')) {
            return { rows: db.xp.filter((row) => row.activity_id === params[0] || row.activity_id === params[1]) };
        }
        if (sql.includes('workout:reverse_xp')) {
            db.xp.push({
                user_id: params[0],
                xp: params[1],
                reason: params[2],
                activity_id: params[3],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:seasonal_sum')) {
            const points = db.seasonal
                .filter((row) => row.user_id === params[0] && row.season_key === params[1])
                .reduce((sum, row) => sum + row.points, 0);
            return { rows: [{ points }] };
        }
        if (sql.includes('workout:load_activity')) {
            return { rows: db.activities.filter((row) => row.id === params[0] && row.user_id === params[1]) };
        }
        if (sql.includes('workout:invalidate_activity')) {
            const row = db.activities.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (row) row.evidence_status = 'INVALIDATED';
            return { rows: [] };
        }
        if (sql.includes('workout:edit_activity')) {
            const row = db.activities.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (row) {
                row.duration_sec = params[2];
                row.distance_m = params[3];
                row.avg_hr = params[4];
            }
            return { rows: [] };
        }
        if (sql.includes('workout:activity_work')) return { rows: [] };
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, query };
}

test('duration and completed work add XP while recovery stays 0', () => {
    const complete = buildXp({
        workoutType: 'run',
        partial: false,
        finishedWork: [{ name: 'Run' }],
        priorSessionsToday: 0,
        durationSec: 2400,
    });
    const recovery = buildXp({
        workoutType: 'recovery',
        partial: false,
        finishedWork: [{ name: 'Recovery' }],
        durationSec: 2400,
    });
    assert.ok(complete.some((row) => row.reason === 'session_base'));
    assert.ok(complete.some((row) => row.reason === 'duration'));
    assert.equal(durationXp(2400), 20);
    assert.equal(totalXpOf(complete), xpConfig.sessionBaseXp + xpConfig.activityXp + 20);
    assert.deepEqual(recovery, []);
});

test('intensity is bounded and later same-day sessions keep a tail instead of a hard cap', () => {
    const hot = intensityFactor({ averageHr: 190, rpe: 10 });
    const easy = intensityFactor({ averageHr: 90, rpe: 2 });
    assert.equal(hot, xpConfig.intensity.maxFactor);
    assert.equal(easy, xpConfig.intensity.minFactor);
    assert.equal(dailyMultiplier(0), 1);
    assert.equal(dailyMultiplier(1), 0.5);
    assert.equal(dailyMultiplier(2), 0.25);
    assert.equal(dailyMultiplier(5), xpConfig.anomaly.tailMultiplier);
    const fifth = buildXp({
        workoutType: 'run',
        partial: false,
        finishedWork: [{ name: 'Run' }],
        priorSessionsToday: 5,
        durationSec: 1800,
    });
    assert.ok(totalXpOf(fifth) > 0);
    assert.ok(fifth.every((row) => row.anomaly));
});

test('level keeps growing after level 4', () => {
    assert.equal(levelState(0).level, 1);
    assert.equal(levelState(500).level, 2);
    assert.equal(levelState(2000).level, 4);
    assert.ok(levelState(3000).level >= 5);
    assert.ok(levelState(16000).nextLevelXp === 0 || levelState(16000).level >= 10);
});

test('delete reverses lifetime XP and seasonal points without changing DNA', async () => {
    const { db, query } = memory();
    db.activities.push({
        id: 'act-1',
        user_id: 'u1',
        source: 'ROXCLUB_NATIVE',
        activity_type: 'run',
        name: 'Run',
        duration_sec: 1800,
        distance_m: 5000,
        avg_hr: null,
        evidence_status: 'STANDARD',
        start_at: '2026-11-04T08:00:00.000Z',
    });
    const rows = buildXp({
        workoutType: 'run',
        finishedWork: [{ name: 'Run' }],
        durationSec: 1800,
        priorSessionsToday: 0,
    });
    await insertXpRows('u1', 'act-1', rows, query, { at: '2026-11-04T08:00:00.000Z' });
    const before = db.xp.reduce((sum, row) => sum + row.xp, 0);
    const season = await loadSeasonalPoints('u1', query, currentSeasonKey('2026-11-04T08:00:00.000Z'));
    assert.equal(season.points, before);
    const result = await invalidateActivity('u1', 'act-1', { query });
    assert.equal(result.status, 'INVALIDATED');
    assert.equal(db.xp.reduce((sum, row) => sum + row.xp, 0), 0);
    assert.equal(db.activities[0].evidence_status, 'INVALIDATED');
});

test('material duration edit recalculates XP', async () => {
    const { db, query } = memory();
    db.activities.push({
        id: 'act-2',
        user_id: 'u1',
        source: 'STRAVA',
        activity_type: 'running',
        name: 'Run',
        duration_sec: 1800,
        distance_m: 5000,
        avg_hr: null,
        evidence_status: 'STANDARD',
        start_at: '2026-11-04T08:00:00.000Z',
    });
    await insertXpRows(
        'u1',
        'act-2',
        buildXp({ workoutType: 'run', finishedWork: [{ name: 'running' }], durationSec: 1800 }),
        query,
        { at: '2026-11-04T08:00:00.000Z' }
    );
    const edited = await editActivity('u1', 'act-2', { durationSec: 3600 }, { query });
    assert.equal(edited.recalculated, true);
    assert.ok(edited.totalXp > 0);
    assert.equal(db.activities[0].duration_sec, 3600);
    assert.ok(db.xp.some((row) => String(row.reason).startsWith('rev:')));
});
