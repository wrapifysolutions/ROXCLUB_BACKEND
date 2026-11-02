const test = require('node:test');
const assert = require('node:assert/strict');
const { attributeEvidenceCatalog } = require('../lib/athlete/attributeEvidence');
const { recordVo2maxSample, recordRaceCalibrationEvidence } = require('../lib/athlete/signalEvidence');
const { runDnaEvidence } = require('../lib/workout/evidenceWorkers');
const { getAthleteDna } = require('../lib/athlete/dnaService');
const { loadEngineInputs } = require('../lib/athlete/engineInputs');
const { buildHomeResponse } = require('../lib/home/homeState');

function store() {
    const db = { signals: [], races: [], evidence: [], splits: [], dna: [] };
    const query = async (sql, params = []) => {
        if (sql.includes('engine:upsert_signal')) {
            const key = `${params[0]}:${params[3]}:${params[4]}`;
            let row = db.signals.find((item) => item.key === key);
            if (!row) {
                row = { key, id: `sig-${db.signals.length + 1}`, user_id: params[0], value_numeric: params[1] };
                db.signals.push(row);
            } else {
                row.value_numeric = params[1];
            }
            return { rows: [row] };
        }
        if (sql.includes('engine:upsert_race_calibration')) {
            if (params[9] === 'ARENA_VIRTUAL') {
                const error = new Error('check');
                error.code = '23514';
                throw error;
            }
            const key = `${params[0]}:${params[9]}:${params[1]}:${params[2]}`;
            let row = db.races.find((item) => item.key === key);
            if (!row) {
                row = { key, id: `race-${db.races.length + 1}`, user_id: params[0], verification_status: params[8] };
                db.races.push(row);
            }
            return { rows: [row] };
        }
        if (sql.includes('workout:evidence_splits')) {
            return { rows: db.splits.filter((row) => row.activity_id === params[0]) };
        }
        if (sql.includes('workout:insert_dna_evidence')) {
            const key = `${params[0]}:${params[1]}`;
            if (!db.evidence.some((row) => row.key === key)) {
                db.evidence.push({ key, payload: JSON.parse(params[4]) });
            }
            return { rows: [] };
        }
        if (sql.includes('engine:dna_snapshots')) return { rows: [] };
        if (sql.includes('engine:dna')) return { rows: db.dna.filter((row) => row.user_id === params[0]) };
        if (sql.includes('engine:proficiency')) return { rows: [] };
        if (sql.includes('engine:recent_activities') || sql.includes('arena:latest_readiness')) return { rows: [] };
        if (sql.includes('engine:identity') || sql.includes('engine:cluster_xp')) return { rows: [] };
        if (sql.includes('engine:bodyweight')) {
            return { rows: params[0] === 'athlete-a' ? [{ weight_kg: 82.5 }] : [] };
        }
        if (sql.includes('engine:signal_evidence')) {
            return { rows: db.signals.filter((row) => row.user_id === params[0]).slice(0, 1) };
        }
        if (sql.includes('engine:race_calibration')) {
            return { rows: db.races.filter((row) => row.user_id === params[0]) };
        }
        throw new Error(sql);
    };
    return { db, query };
}

test('five DNA attribute mappings stay pending approval', () => {
    const catalog = attributeEvidenceCatalog();
    assert.equal(catalog.status, 'PENDING_APPROVAL');
    assert.deepEqual(
        catalog.attributes.map((row) => row.key),
        ['endurance', 'engine', 'strength', 'power', 'speed']
    );
    assert.equal(catalog.attributes.every((row) => row.mappingStatus === 'PENDING_APPROVAL'), true);
    assert.equal(catalog.attributes.find((row) => row.key === 'strength').availableInputs[0], 'bodyweightKg');
});

test('activity evidence keeps raw metrics and does not assign an attribute', async () => {
    const { db, query } = store();
    db.splits.push({
        activity_id: 'act-1',
        activity_index: 0,
        kind: 'run',
        name: 'Easy Run',
        duration_sec: 1800,
        distance_m: null,
        reps: null,
        load_kg: null,
        pace_sec_per_km: null,
        avg_hr: 140,
        input_method: 'gps',
        data: {},
    });
    await runDnaEvidence('act-1', query);
    await runDnaEvidence('act-1', query);
    assert.equal(db.evidence.length, 1);
    assert.equal(db.evidence[0].payload.distanceM, null);
    assert.equal(db.evidence[0].payload.avgHr, 140);
    assert.equal(db.evidence[0].payload.attributeMapping.status, 'PENDING_APPROVAL');
    assert.equal(db.evidence[0].payload.attributeMapping.attributes, null);
    assert.equal(db.evidence[0].payload.provenance.activityId, 'act-1');
});

test('VO2max and race evidence stay isolated and do not score DNA', async () => {
    const { db, query } = store();
    const first = await recordVo2maxSample(
        'athlete-a',
        { value: 48.2, unit: 'ml/kg/min', source: 'apple_health', externalId: 'vo2-1', capturedAt: '2026-11-02T08:00:00Z' },
        query
    );
    const replay = await recordVo2maxSample(
        'athlete-a',
        { value: 49, unit: 'ml/kg/min', source: 'apple_health', externalId: 'vo2-1', capturedAt: '2026-11-02T09:00:00Z' },
        query
    );
    await recordVo2maxSample(
        'athlete-b',
        { value: 40, unit: 'ml/kg/min', source: 'apple_health', externalId: 'vo2-1', capturedAt: '2026-11-02T08:00:00Z' },
        query
    );
    assert.equal(first.id, replay.id);
    assert.equal(db.signals.filter((row) => row.user_id === 'athlete-a').length, 1);
    assert.equal(db.signals.find((row) => row.user_id === 'athlete-a').value_numeric, 49);

    await recordRaceCalibrationEvidence(
        'athlete-a',
        {
            eventName: 'City Hyrox',
            eventDate: '2026-10-01',
            finishTimeSec: 4200,
            verificationStatus: 'verified',
            source: 'official_result',
            runSplits: [{ km: 1, sec: 300 }],
            stationSplits: [{ name: 'SkiErg', sec: 240 }],
        },
        query
    );
    await recordRaceCalibrationEvidence(
        'athlete-a',
        {
            eventName: 'City Hyrox',
            eventDate: '2026-10-01',
            finishTimeSec: 4200,
            verificationStatus: 'verified',
            source: 'official_result',
        },
        query
    );
    assert.equal(db.races.length, 1);
    await assert.rejects(
        () =>
            recordRaceCalibrationEvidence(
                'athlete-a',
                { eventName: 'Virtual', eventDate: '2026-11-02', source: 'ARENA_VIRTUAL', verificationStatus: 'verified' },
                query
            ),
        (error) => error.code === 'VIRTUAL_RACE_NOT_CALIBRATION'
    );

    const dna = await getAthleteDna('athlete-a', { query });
    assert.equal(dna.attributes.endurance.current, null);
    assert.equal(dna.attributeMappings.status, 'PENDING_APPROVAL');
    const inputs = await loadEngineInputs('athlete-a', {}, { query });
    assert.equal(inputs.bodyweightKg, 82.5);
    assert.equal(inputs.vo2max.appliedToDna, false);
    assert.equal(inputs.raceEvidence[0].appliedToDna, false);
    assert.equal(inputs.simulationEngine.available, false);
    const other = await loadEngineInputs('athlete-b', {}, { query });
    assert.equal(other.bodyweightKg, null);
    assert.equal(other.raceEvidence.length, 0);
});

test('home keeps the legacy dna field and exposes the shared pending DNA state', () => {
    const home = buildHomeResponse({
        name: 'Alex',
        dnaStatus: 'CALIBRATING',
        watch: { hrv: { available: true, value: 64, source: 'apple_health' } },
        dna: { endurance: null, engine: null, strength: null, power: null, speed: null, mobility: 70 },
        xpTotal: 0,
        completedSessions: 0,
        todaySession: null,
    });
    assert.equal(home.dna.attributes.hrv, 64);
    assert.equal(home.athleteDna.status, 'CALIBRATING');
    assert.equal(home.athleteDna.attributes.speed.current, null);
    assert.equal(home.athleteDna.attributes.speed.pending, true);
    assert.equal(home.athleteDna.legacy.mobility.current, 70);
    assert.equal(home.athleteDna.legacy.mobility.notSpeed, true);
    assert.equal(home.athleteDna.visibleNumeric, false);
});
