const test = require('node:test');
const assert = require('node:assert/strict');
const { upsertCanonicalImportedActivity } = require('../lib/athlete/canonicalActivity');
const { loadEngineInputs } = require('../lib/athlete/engineInputs');
const { runStationEvidence, runDnaEvidence } = require('../lib/workout/evidenceWorkers');

function memory() {
    const db = {
        activities: [],
        splits: [],
        proficiency: [],
        dna: [{ user_id: 'u1', status: 'CALIBRATING', model_version: 'v0', strength: null, engine: null, endurance: null, power: null, mobility: null }],
        dnaWrites: 0,
    };
    const query = async (sql, params = []) => {
        if (sql.includes('engine:identity') || sql.includes('engine:cluster_xp')) {
            return { rows: [] };
        }
        if (sql.includes('engine:insert_proficiency_evidence')) {
            db.proficiencyEvidence = db.proficiencyEvidence || [];
            const key = `${params[0]}:${params[1]}:${params[2]}:${params[3]}`;
            if (db.proficiencyEvidence.includes(key)) return { rows: [] };
            db.proficiencyEvidence.push(key);
            return { rows: [{ activity_id: params[2] }] };
        }
        if (sql.includes('engine:insert_proficiency_history')) return { rows: [] };
        if (sql.includes('engine:dna_snapshots')) return { rows: [] };
        if (sql.includes('engine:upsert_canonical')) {
            const existing = db.activities.find(
                (row) => row.user_id === params[0] && row.source === params[1] && row.external_id === params[11]
            );
            if (existing) {
                existing.duration_sec = params[8];
                existing.distance_m = params[9];
                return { rows: [{ id: existing.id }] };
            }
            const row = {
                id: `act-${db.activities.length + 1}`,
                user_id: params[0],
                source: params[1],
                activity_type: params[4],
                name: params[5],
                start_at: params[6],
                duration_sec: params[8],
                distance_m: params[9],
                evidence_status: 'STANDARD',
                external_id: params[11],
            };
            db.activities.push(row);
            return { rows: [{ id: row.id }] };
        }
        if (sql.includes('engine:upsert_proficiency')) {
            const existing = db.proficiency.find((row) => row.user_id === params[0] && row.station_key === params[1]);
            if (existing) {
                existing.evidence_count += 1;
                existing.last_activity_id = params[2];
                return { rows: [] };
            }
            db.proficiency.push({
                user_id: params[0],
                station_key: params[1],
                evidence_count: 1,
                last_activity_id: params[2],
                last_evidence_status: params[3],
                status: 'CALIBRATING',
                score: null,
                score_status: 'PENDING_MODEL',
            });
            return { rows: [] };
        }
        if (sql.includes('engine:dna')) {
            return { rows: db.dna.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('engine:proficiency')) {
            return { rows: db.proficiency.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('engine:bodyweight') || sql.includes('engine:signal_evidence') || sql.includes('engine:race_calibration')) {
            return { rows: [] };
        }
        if (sql.includes('engine:recent_activities')) {
            return { rows: db.activities.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('arena:latest_readiness')) return { rows: [] };
        if (sql.includes('workout:evidence_splits')) {
            return { rows: db.splits.filter((row) => row.activity_id === params[0]) };
        }
        if (sql.includes('workout:insert_dna_evidence')) return { rows: [] };
        if (sql.includes('workout:insert_station_evidence')) return { rows: [] };
        if (sql.includes('workout:load_activity_owner')) {
            const row = db.activities.find((item) => item.id === params[0]);
            return { rows: row ? [row] : [] };
        }
        if (sql.includes('UPDATE athlete_dna') || sql.includes('INSERT INTO athlete_dna')) {
            db.dnaWrites += 1;
            return { rows: [] };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, query };
}

test('imported activities upsert canonically by source and external id', async () => {
    const { db, query } = memory();
    const first = await upsertCanonicalImportedActivity(
        'u1',
        {
            source: 'STRAVA',
            externalId: '99',
            activityType: 'Run',
            name: 'Morning',
            startAt: '2026-11-01T06:00:00Z',
            durationSec: 1800,
            distanceM: 5000,
        },
        query
    );
    const second = await upsertCanonicalImportedActivity(
        'u1',
        {
            source: 'STRAVA',
            externalId: '99',
            activityType: 'Run',
            name: 'Morning',
            startAt: '2026-11-01T06:00:00Z',
            durationSec: 1820,
            distanceM: 5050,
        },
        query
    );
    assert.equal(first, second);
    assert.equal(db.activities.length, 1);
    assert.equal(db.activities[0].source, 'STRAVA');
    assert.equal(db.activities[0].activity_type, 'running');
    assert.equal(db.activities[0].duration_sec, 1820);
});

test('station evidence increments proficiency without inventing a score', async () => {
    const { db, query } = memory();
    db.activities.push({ id: 'act-1', user_id: 'u1', evidence_status: 'STANDARD' });
    db.splits.push({
        activity_id: 'act-1',
        activity_index: 1,
        kind: 'station',
        name: 'SkiErg',
        duration_sec: 240,
        distance_m: 1000,
        reps: null,
        load_kg: null,
        data: {},
    });
    await runDnaEvidence('act-1', query);
    await runStationEvidence('act-1', query);
    assert.equal(db.proficiency.length, 1);
    assert.equal(db.proficiency[0].station_key, 'ski_erg');
    assert.equal(db.proficiency[0].score, null);
    assert.equal(db.dnaWrites, 0);
    assert.equal(db.dna[0].strength, null);
});

test('shared engine inputs stay pending until approved models exist', async () => {
    const { query } = memory();
    const inputs = await loadEngineInputs('u1', { pacingStrategy: 'target' }, { query, now: new Date('2026-11-02T12:00:00Z') });
    assert.equal(inputs.athleteDna.status, 'CALIBRATING');
    assert.equal(inputs.athleteDna.visibleNumeric, false);
    assert.equal(inputs.simulationEngine.available, false);
    assert.equal(inputs.fatigueModel.available, false);
    assert.equal(inputs.athleteId, 'u1');
});

test('engine inputs stay readable when identity links are not migrated', async () => {
    const { query } = memory();
    const wrapped = async (sql, params) => {
        if (sql.includes('engine:identity_links_for_user')) {
            const error = new Error('relation "activity_identity_links" does not exist');
            error.code = '42P01';
            throw error;
        }
        return query(sql, params);
    };
    const inputs = await loadEngineInputs('u1', {}, { query: wrapped, now: new Date('2026-11-02T12:00:00Z') });
    assert.equal(inputs.simulationEngine.available, false);
    assert.equal(inputs.recentEvidenceConfidence, null);
    assert.deepEqual(inputs.recentActivities, []);
});
