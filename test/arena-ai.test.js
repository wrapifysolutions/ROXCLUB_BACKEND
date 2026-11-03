const test = require('node:test');
const assert = require('node:assert/strict');
const { explainArena } = require('../lib/arena/arenaAiService');
const { joinEvent, saveStrategy } = require('../lib/arena/arenaService');
const { startEvent, finishSession } = require('../lib/arena/sessionService');
const { ExplainArena } = require('../controllers/Arena/ArenaControllers');
const { providerStatus } = require('../lib/ai/provider');

function harness() {
    const db = {
        seq: 1,
        users: [{ id: 'a1', display_name: 'Atif', account_type: 'athlete', onboarding_completed: true }],
        events: [],
        versions: [],
        stations: [],
        participants: [],
        strategies: [],
        sessions: [],
        segments: [],
        results: [],
        audits: [],
        now: new Date('2026-11-02T12:00:00Z'),
    };
    const nextId = (prefix) => `${prefix}-${db.seq++}`;
    const nowIso = () => db.now.toISOString();
    const event = {
        id: 'event-1',
        slug: 'coastal',
        title: 'Coastal Hybrid Challenge',
        description: '',
        image_key: null,
        location: 'Sydney',
        event_type: 'simulation',
        division: 'open',
        category: 'hybrid',
        difficulty: null,
        club_id: null,
        status: 'open',
        starts_at: '2026-11-01T00:00:00.000Z',
        ends_at: '2026-11-30T00:00:00.000Z',
        published_at: nowIso(),
    };
    db.events.push(event);
    const version = {
        id: 'ver-1',
        event_id: event.id,
        version_no: 1,
        format_key: 'hybrid_endurance_v1',
        estimated_duration_ms: 9736000,
        frozen_at: nowIso(),
        rules: { orderFixed: true, movementStandards: ['Fixed order'], overview: 'Hybrid simulation' },
    };
    db.versions.push(version);
    db.stations.push(
        { version_id: version.id, sequence: 1, segment_type: 'run', station_key: 'run_1', title: 'Run 1', distance_m: 1000, repetitions: null, load_kg: null, instructions: '' },
        { version_id: version.id, sequence: 2, segment_type: 'station', station_key: 'ski_erg', title: 'Ski Ergometer', distance_m: 1000, repetitions: null, load_kg: null, instructions: '' }
    );

    const query = async (sql, params = []) => {
        if (sql.includes('arena:load_user')) return { rows: db.users.filter((row) => row.id === params[0]) };
        if (sql.includes('arena:load_event')) {
            return { rows: [{ ...event, version_id: version.id, version_no: 1, format_key: version.format_key, estimated_duration_ms: version.estimated_duration_ms, rules: version.rules, frozen_at: version.frozen_at }] };
        }
        if (sql.includes('arena:list_stations')) return { rows: db.stations };
        if (sql.includes('arena:load_participation')) return { rows: db.participants.filter((row) => row.event_id === params[0] && row.user_id === params[1]) };
        if (sql.includes('arena:join')) {
            const row = { id: nextId('part'), event_id: params[0], event_version_id: params[1], user_id: params[2], status: 'joined', joined_at: nowIso() };
            db.participants.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:load_strategy')) return { rows: db.strategies.filter((row) => row.participant_id === params[0]) };
        if (sql.includes('arena:upsert_strategy')) {
            const row = {
                participant_id: params[0],
                strategy_version: 1,
                goal_time_ms: params[4],
                run_pace_ms_per_km: params[5],
                pacing_strategy: params[6],
                station_targets: JSON.parse(params[7]),
                validation: JSON.parse(params[8]),
            };
            db.strategies = [row];
            return { rows: [row] };
        }
        if (sql.includes('arena:latest_readiness')) return { rows: [{ status: 'READY', score: 72, confidence: 'MODERATE', local_date: '2026-11-02' }] };
        if (sql.includes('engine:dna_snapshots')) return { rows: [] };
        if (sql.includes('engine:dna')) return { rows: [] };
        if (sql.includes('engine:proficiency')) return { rows: [] };
        if (sql.includes('engine:recent_activities')) return { rows: [] };
        if (sql.includes('arena:dna_snapshot')) return { rows: [] };
        if (sql.includes('arena:open_session') || sql.includes('arena:completed_session')) return { rows: [] };
        if (sql.includes('arena:insert_session')) {
            const row = {
                id: 'sess-1',
                participant_id: params[0],
                user_id: params[1],
                event_id: params[2],
                event_version_id: params[3],
                status: 'active',
                prepared_at: nowIso(),
                started_at: nowIso(),
                current_sequence: 1,
                engine_available: false,
                dna_snapshot: params[4] == null ? null : typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
                evidence_snapshot: params[5] == null ? null : typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
            };
            db.sessions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:insert_segment')) return { rows: [] };
        if (sql.includes('arena:mark_started')) return { rows: [] };
        if (sql.includes('arena:load_session')) return { rows: db.sessions.filter((row) => row.id === params[0] && row.user_id === params[1]) };
        if (sql.includes('arena:session_segments')) return { rows: [] };
        if (sql.includes('arena:finish_session')) {
            db.sessions[0].status = 'completed';
            db.sessions[0].finished_at = nowIso();
            return { rows: [] };
        }
        if (sql.includes('arena:mark_completed')) return { rows: [] };
        if (sql.includes('arena:insert_result')) {
            const row = { id: 'res-1', session_id: params[0], user_id: params[1], event_id: params[2], event_version_id: params[3], total_elapsed_ms: params[4], result_status: 'unverified', evidence_source: 'virtual_session', competitive_eligible: false };
            db.results.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:audit_result')) return { rows: [] };
        if (sql.includes('arena:load_result')) return { rows: db.results };
        if (sql.includes('arena:history_item')) {
            const session = db.sessions[0];
            const result = db.results[0];
            return {
                rows: [
                    {
                        ...session,
                        title: event.title,
                        image_key: null,
                        event_starts_at: event.starts_at,
                        event_ends_at: event.ends_at,
                        category: event.category,
                        result_id: result?.id,
                        total_elapsed_ms: result?.total_elapsed_ms,
                        result_status: result?.result_status,
                        evidence_source: result?.evidence_source,
                        competitive_eligible: result?.competitive_eligible,
                    },
                ],
            };
        }
        if (sql.includes('engine:identity') || sql.includes('engine:cluster_xp')) return { rows: [] };
        if (sql.includes('engine:bodyweight') || sql.includes('engine:signal_evidence') || sql.includes('engine:race_calibration')) {
            return { rows: [] };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, event, opts: { query, now: db.now, env: {} } };
}

test('unauthenticated Arena AI explain is rejected', async () => {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await ExplainArena({ user: null, body: { context: 'readiness' } }, res);
    assert.equal(res.statusCode, 401);
});

test('unsupported explanation context is rejected', async () => {
    const { opts } = harness();
    await assert.rejects(
        () => explainArena('a1', { context: 'invent_workout' }, opts),
        (error) => error.code === 'INVALID_CONTEXT'
    );
});

test('goal and pace explanation uses stored values and does not invent a prediction', async () => {
    const { opts, event } = harness();
    await joinEvent('a1', event.id, opts);
    await saveStrategy('a1', event.id, { goalTime: '02:42:16', runPace: '02:42' }, opts);
    const explained = await explainArena('a1', { context: 'goal_and_pace', eventId: event.id }, opts);
    assert.equal(explained.available, false);
    assert.equal(explained.unavailable.code, 'AI_PROVIDER_NOT_CONFIGURED');
    assert.match(explained.explanation, /02:42:16/);
    assert.match(explained.explanation, /02:42/);
    assert.equal(explained.facts.predictionAvailable, false);
    assert.equal(explained.simulationEngine.available, false);
    assert.equal(explained.sourceData.virtualRaceEngine, false);
});

test('race rules explanation uses the published station order', async () => {
    const { opts, event } = harness();
    const explained = await explainArena('a1', { context: 'race_rules', eventId: event.id }, opts);
    assert.match(explained.explanation, /Ski Ergometer/);
    assert.equal(explained.facts.aboutRules, 'Hybrid simulation');
    assert.equal(explained.facts.stations[0].title, 'Ski Ergometer');
    assert.equal(explained.facts.stations[0].value, '1 km');
});

test('readiness explanation does not accept client-supplied scores', async () => {
    const { opts } = harness();
    const explained = await explainArena('a1', { context: 'readiness', readinessScore: 99, athleteDna: { power: 100 } }, opts);
    assert.equal(explained.facts.readiness.score, 72);
    assert.equal(explained.sourceData.athleteDna, false);
    assert.equal(explained.explanation.includes('99'), false);
});

test('race summary does not promote a virtual finish to official ranking', async () => {
    const { opts, event, db } = harness();
    await joinEvent('a1', event.id, opts);
    const session = await startEvent('a1', event.id, opts);
    await finishSession('a1', session.id, opts);
    const explained = await explainArena('a1', { context: 'race_summary', sessionId: session.id }, opts);
    assert.equal(explained.facts.officialCompleted, false);
    assert.equal(explained.facts.evidenceSource, 'virtual_session');
    assert.equal(db.results[0].competitive_eligible, false);
});

test('a configured provider can present the same approved facts', async () => {
    const { opts, event } = harness();
    opts.env = { OPENAI_API_KEY: 'test-key', OPENAI_MODEL: 'test-model' };
    opts.fetchImpl = async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'Your stored goal is 02:42:16. Pace is independent.' } }] }),
    });
    await joinEvent('a1', event.id, opts);
    await saveStrategy('a1', event.id, { goalTime: '02:42:16', runPace: '02:42' }, opts);
    const explained = await explainArena('a1', { context: 'goal_and_pace', eventId: event.id }, opts);
    assert.equal(explained.available, true);
    assert.equal(explained.generation, 'model');
    assert.match(explained.explanation, /02:42:16/);
});

test('no AI provider is configured in this repository by default', () => {
    const status = providerStatus({});
    assert.equal(status.available, false);
    assert.equal(status.reason, 'AI_PROVIDER_NOT_CONFIGURED');
});
