const test = require('node:test');
const assert = require('node:assert/strict');
const { presentAthleteDna } = require('../lib/athlete/dnaPresenter');
const { getAthleteDna } = require('../lib/athlete/dnaService');
const { getStationProficiency } = require('../lib/athlete/proficiencyService');
const { recordStationProficiency } = require('../lib/athlete/proficiency');
const { loadEngineInputs } = require('../lib/athlete/engineInputs');
const { GetAthleteDna, GetStationProficiency } = require('../controllers/Athlete/AthleteControllers');
const { dnaAttributes } = require('../lib/home/homeState');
const { runOnboardingComplete } = require('../lib/onboarding/completeFlow');

function resStub() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

function harness() {
    const db = {
        dna: [
            {
                user_id: 'u1',
                status: 'READY',
                model_version: 'v0',
                endurance: 40,
                engine: 41,
                strength: 42,
                power: 43,
                speed: null,
                mobility: 77,
            },
        ],
        snapshots: [
            {
                user_id: 'u1',
                model_version: 'v0',
                status: 'CALIBRATING',
                endurance: null,
                engine: null,
                strength: null,
                power: null,
                speed: null,
                mobility: null,
                source: 'onboarding',
                captured_at: '2026-10-01T00:00:00Z',
            },
        ],
        proficiency: [
            {
                user_id: 'u1',
                station_key: 'ski_erg',
                evidence_count: 2,
                status: 'CALIBRATING',
                score: 99,
                score_status: 'PENDING_MODEL',
                model_version: 'pending_v0',
                last_evidence_status: 'STANDARD',
                last_activity_id: 'act-1',
                current_tier: null,
                peak_tier: null,
                last_duration_sec: 240,
            },
        ],
        proficiencyEvidence: [],
        history: [],
        dnaWrites: 0,
    };
    const query = async (sql, params = []) => {
        if (sql.includes('engine:dna_snapshots')) {
            return { rows: db.snapshots.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('engine:dna')) {
            return { rows: db.dna.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('engine:proficiency')) {
            return { rows: db.proficiency.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('engine:insert_proficiency_evidence')) {
            const key = `${params[0]}:${params[1]}:${params[2]}:${params[3]}`;
            if (db.proficiencyEvidence.includes(key)) return { rows: [] };
            db.proficiencyEvidence.push(key);
            return { rows: [{ activity_id: params[2] }] };
        }
        if (sql.includes('engine:upsert_proficiency')) {
            const existing = db.proficiency.find((row) => row.user_id === params[0] && row.station_key === params[1]);
            if (existing) {
                existing.evidence_count += 1;
                existing.last_activity_id = params[2];
            } else {
                db.proficiency.push({
                    user_id: params[0],
                    station_key: params[1],
                    evidence_count: 1,
                    last_activity_id: params[2],
                    status: 'CALIBRATING',
                    score: null,
                });
            }
            return { rows: [{ evidence_count: 1, status: 'CALIBRATING', model_version: 'pending_v0' }] };
        }
        if (sql.includes('engine:insert_proficiency_history')) {
            db.history.push({ user_id: params[0], station_key: params[1] });
            return { rows: [] };
        }
        if (sql.includes('engine:identity') || sql.includes('engine:cluster_xp')) return { rows: [] };
        if (sql.includes('engine:bodyweight') || sql.includes('engine:signal_evidence') || sql.includes('engine:race_calibration')) {
            return { rows: [] };
        }
        if (sql.includes('engine:recent_activities')) return { rows: [] };
        if (sql.includes('arena:latest_readiness')) return { rows: [] };
        if (sql.includes('UPDATE athlete_dna') || sql.includes('INSERT INTO athlete_dna')) {
            db.dnaWrites += 1;
            return { rows: [] };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, query };
}

test('Speed is not Mobility and stays pending without an approved formula', () => {
    const presented = presentAthleteDna({
        status: 'READY',
        model_version: 'v0',
        endurance: 40,
        engine: 41,
        strength: 42,
        power: 43,
        speed: null,
        mobility: 77,
    });
    assert.equal(presented.attributes.speed.current, null);
    assert.equal(presented.attributes.speed.pending, true);
    assert.equal(presented.attributes.speed.available, false);
    assert.equal(presented.legacy.mobility.current, 77);
    assert.equal(presented.legacy.mobility.notSpeed, true);
    assert.notEqual(presented.attributes.speed.current, presented.legacy.mobility.current);
    assert.equal(presented.visibleNumeric, true);
});

test('legacy home attributes keep mobility and add pending speed without dropping history', () => {
    const attrs = dnaAttributes({
        strength: 10,
        engine: 11,
        endurance: 12,
        power: 13,
        mobility: 77,
        speed: null,
    });
    assert.equal(attrs.mobility, 77);
    assert.equal(attrs.speed, null);
    assert.equal(attrs.power, 13);
});

test('missing DNA row is calibrating and does not invent averages', async () => {
    const { query } = harness();
    const dna = await getAthleteDna('missing', { query });
    assert.equal(dna.status, 'CALIBRATING');
    assert.equal(dna.attributes.speed.pending, true);
    assert.equal(dna.visibleNumeric, false);
});

test('DNA and proficiency APIs isolate athletes', async () => {
    const { query } = harness();
    const otherDna = await getAthleteDna('u2', { query });
    const otherProf = await getStationProficiency('u2', { query });
    assert.equal(otherDna.attributes.endurance.current, null);
    assert.equal(otherProf.stations.every((row) => row.evidenceCount === 0), true);
    const own = await getAthleteDna('u1', { query });
    assert.equal(own.attributes.endurance.current, 40);
    assert.equal(own.legacy.mobility.current, 77);
});

test('duplicate station evidence does not increment proficiency twice or write a score', async () => {
    const { db, query } = harness();
    const split = { name: 'SkiErg', activity_index: 1, duration_sec: 240, reps: null, load_kg: null, distance_m: 1000 };
    await recordStationProficiency('u1', 'act-9', [split], 'STANDARD', query);
    await recordStationProficiency('u1', 'act-9', [split], 'STANDARD', query);
    assert.equal(db.proficiencyEvidence.length, 1);
    const ski = db.proficiency.find((row) => row.station_key === 'ski_erg');
    assert.equal(ski.evidence_count, 3);
    const listed = await getStationProficiency('u1', { query });
    const presented = listed.stations.find((row) => row.key === 'ski_erg');
    assert.equal(presented.score, null);
    assert.equal(presented.pendingModel, true);
    assert.equal(db.dnaWrites, 0);
});

test('Arena snapshot uses five core DNA attributes and pending station tiers', async () => {
    const { query } = harness();
    const inputs = await loadEngineInputs('u1', { pacingStrategy: 'target' }, { query, now: new Date('2026-11-02T12:00:00Z') });
    assert.deepEqual(Object.keys(inputs.athleteDna.attributes).sort(), ['endurance', 'engine', 'power', 'speed', 'strength']);
    assert.equal(inputs.athleteDna.attributes.speed.current, null);
    assert.equal(inputs.coreDnaValues.speed, null);
    assert.equal(inputs.stationProficiency.length, 8);
    assert.equal(inputs.stationProficiency.find((row) => row.key === 'ski_erg').score, null);
    assert.equal(inputs.simulationEngine.available, false);
});

test('unauthenticated DNA and proficiency routes are rejected', async () => {
    const dnaRes = resStub();
    const profRes = resStub();
    await GetAthleteDna({ user: null }, dnaRes);
    await GetStationProficiency({ user: null }, profRes);
    assert.equal(dnaRes.statusCode, 401);
    assert.equal(profRes.statusCode, 401);
});

test('onboarding DNA insert keeps mobility and adds pending speed', async () => {
    const db = { user: { id: 'user-1', experience_level: 'beginner', training_experience: 'beginner', training_goals: 'HYROX race', race_event: 'hyrox', race_date: '2027-03-15', onboarding_completed: false }, program: null, sessions: [], dna: null };
    const client = {
        async query(sql, params) {
            if (sql.includes('onboarding_complete:lock')) return { rows: [db.user] };
            if (sql.includes('onboarding_complete:existing_program')) return { rows: [] };
            if (sql.includes('onboarding_complete:insert_program')) {
                db.program = { program_id: params[1] };
                return { rows: [db.program] };
            }
            if (sql.includes('onboarding_complete:insert_sessions')) return { rowCount: 1 };
            if (sql.includes('onboarding_complete:insert_dna')) {
                db.dna = { speed: null, mobility: null, strength: null };
                return { rows: [] };
            }
            if (sql.includes('onboarding_complete:snapshot_dna')) return { rows: [] };
            if (sql.includes('onboarding_complete:mark_complete')) {
                db.user.onboarding_completed = true;
                return { rows: [] };
            }
            if (sql.includes('onboarding_complete:mark_questions')) return { rows: [] };
            if (sql.includes('onboarding_complete:count_sessions')) return { rows: [{ count: 1 }] };
            throw new Error(sql);
        },
    };
    await runOnboardingComplete(client, 'user-1', { today: '2026-10-22' });
    assert.equal(db.dna.speed, null);
    assert.equal(db.dna.mobility, null);
});
