const test = require('node:test');
const assert = require('node:assert/strict');
const { gatherSignals, computeReadiness } = require('../lib/readiness/readinessService');
const { recordImportedWorkout, collapseImportedFeed } = require('../lib/athlete/importedWorkout');
const { suggestReducedLoad } = require('../lib/plan/adaptationService');
const { buildHomeResponse } = require('../lib/home/homeState');
const { buildXp } = require('../lib/workout/xpService');

const TODAY = '2026-11-04';

function emptySignals(sql) {
    if (sql.includes('readiness:sessions_')) return { rows: [] };
    if (sql.includes('readiness:debrief')) return { rows: [] };
    if (sql.includes('readiness:wellness')) return { rows: [] };
    if (sql.includes('readiness:checkin_row')) return { rows: [] };
    throw new Error(`unexpected sql: ${sql}`);
}

function importMemory() {
    const db = { activities: [], links: [], xp: [] };
    const query = async (sql, params = []) => {
        if (sql.includes('engine:upsert_canonical')) {
            const existing = db.activities.find(
                (row) => row.user_id === params[0] && row.source === params[1] && row.external_id === params[11]
            );
            if (existing) {
                existing.duration_sec = params[8];
                return { rows: [{ id: existing.id }] };
            }
            const row = {
                id: `act-${db.activities.length + 1}`,
                user_id: params[0],
                source: params[1],
                activity_type: params[4],
                start_at: params[6],
                duration_sec: params[8],
                external_id: params[11],
            };
            db.activities.push(row);
            return { rows: [{ id: row.id }] };
        }
        if (sql.includes('engine:identity_owners')) {
            return { rows: db.activities.filter((row) => row.id === params[0] || row.id === params[1]) };
        }
        if (sql.includes('engine:identity_neighbors')) {
            return {
                rows: db.activities.filter(
                    (row) =>
                        row.user_id === params[0] &&
                        row.id !== params[1] &&
                        row.start_at >= params[2] &&
                        row.start_at <= params[3]
                ),
            };
        }
        if (sql.includes('engine:insert_identity_link')) {
            const existing = db.links.find((row) => row.activity_a === params[0] && row.activity_b === params[1]);
            if (existing) {
                if (existing.status !== 'associated' && params[3] === 'associated') existing.status = 'associated';
                return { rows: [existing] };
            }
            const row = {
                activity_a: params[0],
                activity_b: params[1],
                user_id: params[2],
                status: params[3],
            };
            db.links.push(row);
            return { rows: [row] };
        }
        if (sql.includes('engine:cluster_xp')) {
            const linked = db.links.filter(
                (row) =>
                    row.user_id === params[0] &&
                    row.status === 'associated' &&
                    (row.activity_a === params[1] || row.activity_b === params[1])
            );
            const otherIds = linked.flatMap((row) => [row.activity_a, row.activity_b]).filter((id) => id !== params[1]);
            return { rows: db.xp.filter((row) => otherIds.includes(row.activity_id)) };
        }
        if (sql.includes('engine:import_xp_prior')) {
            return {
                rows: [
                    {
                        count: new Set(
                            db.xp.filter((row) => row.user_id === params[0] && row.reason === 'session_base').map((row) => row.activity_id)
                        ).size,
                    },
                ],
            };
        }
        if (sql.includes('engine:import_xp_net')) {
            const rows = db.xp.filter((row) => row.user_id === params[0] && row.activity_id === params[1]);
            return {
                rows: [
                    {
                        xp: rows.reduce((sum, row) => sum + row.xp, 0),
                        rows: rows.length,
                    },
                ],
            };
        }
        if (sql.includes('engine:import_xp') || sql.includes('workout:insert_xp')) {
            db.xp.push({
                user_id: params[0],
                xp: params[1],
                reason: params[2],
                activity_id: params[3],
            });
            return { rows: [] };
        }
        if (sql.includes('workout:insert_seasonal') || sql.includes('workout:reverse_seasonal')) {
            return { rows: [] };
        }
        if (sql.includes('engine:identity_links_for_user')) {
            return { rows: db.links.filter((row) => row.user_id === params[0] && row.status === 'associated') };
        }
        if (sql.includes('engine:feed_activity_index')) {
            return { rows: db.activities.filter((row) => row.user_id === params[0]) };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, query };
}

test('Samsung and Garmin workouts count toward official readiness load', async () => {
    const days = ['02', '03', '04'];
    const samsung = days.map((day) => ({
        start_at: `2026-11-${day}T07:00:00.000Z`,
        end_at: `2026-11-${day}T07:40:00.000Z`,
        metadata: { sport_type: 'Run', duration_seconds: '2400' },
    }));
    const garmin = days.map((day) => ({
        start_at: `2026-11-${day}T07:01:00.000Z`,
        duration_seconds: 2400,
        activity_type: 'RUNNING',
    }));

    const signals = await gatherSignals('user-watch', TODAY, async (sql) => {
        if (sql.includes('readiness:sessions_samsung')) return { rows: samsung };
        if (sql.includes('readiness:sessions_garmin')) return { rows: garmin };
        return emptySignals(sql);
    });
    const result = computeReadiness(signals);

    assert.equal(signals.completedSessions, 3);
    assert.equal(typeof result.score, 'number');
    assert.notEqual(result.status, 'CALIBRATING');
});

test('Apple and Samsung imported workouts award v0 XP once per associated cluster', async () => {
    const { db, query } = importMemory();
    const expected = buildXp({
        workoutType: 'imported',
        partial: false,
        finishedWork: [{ name: 'Run' }],
        priorSessionsToday: 0,
        durationSec: 1800,
    });

    await recordImportedWorkout(
        'u1',
        {
            source: 'APPLE_HEALTH',
            externalId: 'a1',
            activityType: 'Run',
            startAt: '2026-11-04T08:00:00.000Z',
            durationSec: 1800,
        },
        query
    );
    await recordImportedWorkout(
        'u1',
        {
            source: 'SAMSUNG_HEALTH',
            externalId: 's1',
            activityType: 'Run',
            startAt: '2026-11-04T08:01:00.000Z',
            durationSec: 1800,
        },
        query
    );

    assert.equal(db.activities.length, 2);
    assert.equal(db.links[0].status, 'associated');
    assert.deepEqual(
        db.xp.map((row) => row.reason),
        expected.map((row) => row.reason)
    );
    assert.equal(
        db.xp.reduce((sum, row) => sum + row.xp, 0),
        expected.reduce((sum, row) => sum + row.xp, 0)
    );
});

test('associated imported workouts collapse to one feed row', async () => {
    const { db, query } = importMemory();
    await recordImportedWorkout(
        'u1',
        {
            source: 'STRAVA',
            externalId: 's1',
            activityType: 'Run',
            startAt: '2026-11-04T08:00:00.000Z',
            durationSec: 1800,
        },
        query
    );
    await recordImportedWorkout(
        'u1',
        {
            source: 'GARMIN',
            externalId: 'g1',
            activityType: 'Run',
            startAt: '2026-11-04T08:00:00.000Z',
            durationSec: 1800,
        },
        query
    );
    const feed = await collapseImportedFeed(
        'u1',
        [
            { source: 'strava', external_id: 's1', name: 'Strava run' },
            { source: 'garmin', external_id: 'g1', name: 'Garmin run' },
        ],
        query
    );
    assert.equal(db.activities.length, 2);
    assert.equal(feed.length, 1);
});

test('low readiness offers an approved reduced-load alternative without forcing it', () => {
    const suggestion = suggestReducedLoad({
        status: 'RECOVERY_NEEDED',
        todaySession: { workout_id: 'wk_engine_intervals', title: 'Engine Intervals' },
    });
    assert.equal(suggestion.action, 'reduced_load');
    assert.equal(suggestion.userMayStillTrain, true);
    assert.equal(suggestion.original.workoutId, 'wk_engine_intervals');
    assert.ok(suggestion.alternative.workoutId);
    assert.notEqual(suggestion.alternative.workoutId, 'wk_engine_intervals');
});

test('home does not treat watch HRV as Athlete DNA or a second ready score', () => {
    const home = buildHomeResponse({
        name: 'Alex',
        dnaStatus: 'CALIBRATING',
        watch: { hrv: { available: true, value: 70, source: 'garmin' } },
        dna: { endurance: null, engine: null, strength: null, power: null, speed: null },
        xpTotal: 0,
        completedSessions: 0,
        todaySession: null,
    });
    assert.equal(home.readiness.status, 'CALIBRATING');
    assert.equal(home.readiness.score, null);
    assert.equal(home.dna.status, 'CALIBRATING');
    assert.equal(home.dna.attributes, null);
    assert.equal(home.watch.hrv, 70);
    assert.equal(home.athleteDna.visibleNumeric, false);
});
