const test = require('node:test');
const assert = require('node:assert/strict');
const { newAssignmentBlock } = require('../lib/programs/enrollmentGuard');
const {
    getArenaHome,
    listEvents,
    getEvent,
    getEventRules,
    joinEvent,
    getStrategy,
    saveStrategy,
    getHistory,
    getLeaderboard,
} = require('../lib/arena/arenaService');
const {
    startEvent,
    getSession,
    checkpoint,
    finishSession,
    abandonSession,
} = require('../lib/arena/sessionService');
const { PutArenaStrategy } = require('../controllers/Arena/ArenaControllers');

const STATIONS = [
    { sequence: 1, segment_type: 'run', station_key: 'run_1', title: 'Run 1', distance_m: 1000 },
    { sequence: 2, segment_type: 'station', station_key: 'ski_erg', title: 'Ski Ergometer', distance_m: 1000 },
    { sequence: 3, segment_type: 'run', station_key: 'run_2', title: 'Run 2', distance_m: 1000 },
    { sequence: 4, segment_type: 'station', station_key: 'sled_push', title: 'Sled Push', distance_m: 50 },
    { sequence: 5, segment_type: 'run', station_key: 'run_3', title: 'Run 3', distance_m: 1000 },
    { sequence: 6, segment_type: 'station', station_key: 'sled_pull', title: 'Sled Pull', distance_m: 50 },
    { sequence: 7, segment_type: 'run', station_key: 'run_4', title: 'Run 4', distance_m: 1000 },
    { sequence: 8, segment_type: 'station', station_key: 'burpee_broad_jump', title: 'Burpee Broad Jump', distance_m: 80 },
    { sequence: 9, segment_type: 'run', station_key: 'run_5', title: 'Run 5', distance_m: 1000 },
    { sequence: 10, segment_type: 'station', station_key: 'row', title: 'Row', distance_m: 1000 },
    { sequence: 11, segment_type: 'run', station_key: 'run_6', title: 'Run 6', distance_m: 1000 },
    { sequence: 12, segment_type: 'station', station_key: 'farmers_carry', title: 'Farmers Carry', distance_m: 200 },
    { sequence: 13, segment_type: 'run', station_key: 'run_7', title: 'Run 7', distance_m: 1000 },
    { sequence: 14, segment_type: 'station', station_key: 'sandbag_lunges', title: 'Sandbag Lunges', distance_m: 100 },
    { sequence: 15, segment_type: 'run', station_key: 'run_8', title: 'Run 8', distance_m: 1000 },
    { sequence: 16, segment_type: 'station', station_key: 'wall_balls', title: 'Wall Balls', repetitions: 100 },
];

function harness() {
    const db = {
        seq: 1,
        users: [],
        events: [],
        versions: [],
        stations: [],
        participants: [],
        strategies: [],
        sessions: [],
        segments: [],
        results: [],
        audits: [],
        memberships: [],
        userPrograms: [],
        dna: [],
        proficiency: [],
        activities: [],
        dnaWrites: 0,
        xpWrites: 0,
        now: new Date('2026-11-02T12:00:00Z'),
    };
    const nextId = (prefix) => `${prefix}-${db.seq++}`;
    const nowIso = () => db.now.toISOString();

    const query = async (sql, params = []) => {
        if (sql.includes('arena:load_user')) {
            return { rows: db.users.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('arena:list_events')) {
            return {
                rows: db.events
                    .filter((event) => event.status !== 'draft' && event.published_at)
                    .map((event) => {
                        const version = db.versions.filter((row) => row.event_id === event.id).sort((a, b) => b.version_no - a.version_no)[0];
                        return { ...event, version_id: version?.id, version_no: version?.version_no };
                    }),
            };
        }
        if (sql.includes('arena:load_event')) {
            const event = db.events.find((row) => row.id === params[0] && row.status !== 'draft' && row.published_at);
            if (!event) return { rows: [] };
            const version = db.versions.filter((row) => row.event_id === event.id).sort((a, b) => b.version_no - a.version_no)[0];
            return {
                rows: [
                    {
                        ...event,
                        version_id: version?.id,
                        version_no: version?.version_no,
                        format_key: version?.format_key,
                        estimated_duration_ms: version?.estimated_duration_ms,
                        rules: version?.rules,
                        frozen_at: version?.frozen_at,
                    },
                ],
            };
        }
        if (sql.includes('arena:list_stations')) {
            return {
                rows: db.stations.filter((row) => row.version_id === params[0]).sort((a, b) => a.sequence - b.sequence),
            };
        }
        if (sql.includes('arena:load_participation')) {
            return {
                rows: db.participants.filter((row) => row.event_id === params[0] && row.user_id === params[1]),
            };
        }
        if (sql.includes('arena:club_membership')) {
            return {
                rows: db.memberships.filter(
                    (row) => row.club_id === params[0] && row.athlete_user_id === params[1] && row.status === 'accepted'
                ),
            };
        }
        if (sql.includes('arena:join')) {
            if (db.participants.some((row) => row.event_id === params[0] && row.user_id === params[2])) {
                const error = new Error('duplicate');
                error.code = '23505';
                throw error;
            }
            const row = {
                id: nextId('part'),
                event_id: params[0],
                event_version_id: params[1],
                user_id: params[2],
                status: 'joined',
                joined_at: nowIso(),
            };
            db.participants.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:load_strategy')) {
            return { rows: db.strategies.filter((row) => row.participant_id === params[0]) };
        }
        if (sql.includes('arena:upsert_strategy')) {
            const existing = db.strategies.find((row) => row.participant_id === params[0]);
            const targets = typeof params[7] === 'string' ? JSON.parse(params[7]) : params[7];
            const validation = typeof params[8] === 'string' ? JSON.parse(params[8]) : params[8];
            if (existing) {
                existing.strategy_version += 1;
                existing.goal_time_ms = params[4];
                existing.run_pace_ms_per_km = params[5];
                existing.pacing_strategy = params[6];
                existing.station_targets = targets;
                existing.validation = validation;
                return { rows: [existing] };
            }
            const row = {
                id: nextId('strat'),
                participant_id: params[0],
                user_id: params[1],
                event_id: params[2],
                event_version_id: params[3],
                strategy_version: 1,
                goal_time_ms: params[4],
                run_pace_ms_per_km: params[5],
                pacing_strategy: params[6],
                station_targets: targets,
                validation,
            };
            db.strategies.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:latest_readiness')) return { rows: [] };
        if (sql.includes('engine:dna_snapshots')) return { rows: [] };
        if (sql.includes('engine:insert_dna_snapshot')) return { rows: [] };
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
        if (sql.includes('engine:upsert_canonical')) {
            const existing = db.activities.find(
                (row) => row.user_id === params[0] && row.source === params[1] && row.external_id === params[11]
            );
            if (existing) {
                existing.name = params[5];
                return { rows: [{ id: existing.id }] };
            }
            const row = {
                id: nextId('act'),
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
        if (sql.includes('arena:dna_snapshot')) {
            return { rows: db.dna.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('arena:open_session')) {
            return {
                rows: db.sessions.filter(
                    (row) => row.user_id === params[0] && row.event_id === params[1] && ['prepared', 'active', 'held'].includes(row.status)
                ),
            };
        }
        if (sql.includes('arena:completed_session')) {
            return {
                rows: db.sessions.filter((row) => row.user_id === params[0] && row.event_id === params[1] && row.status === 'completed'),
            };
        }
        if (sql.includes('arena:insert_session')) {
            const row = {
                id: nextId('sess'),
                participant_id: params[0],
                user_id: params[1],
                event_id: params[2],
                event_version_id: params[3],
                status: 'active',
                prepared_at: nowIso(),
                started_at: nowIso(),
                finished_at: null,
                abandoned_at: null,
                current_sequence: 1,
                engine_available: false,
                dna_snapshot: typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4],
                evidence_snapshot: params[5] == null ? null : typeof params[5] === 'string' ? JSON.parse(params[5]) : params[5],
            };
            db.sessions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:insert_segment')) {
            db.segments.push({
                session_id: params[0],
                sequence: params[1],
                station_key: params[2],
                segment_type: params[3],
                title: params[4],
                status: params[1] === 1 ? 'active' : 'pending',
                started_at: params[1] === 1 ? nowIso() : null,
                completed_at: null,
                elapsed_ms: null,
                athlete_decision: null,
            });
            return { rows: [] };
        }
        if (sql.includes('arena:mark_started')) {
            const row = db.participants.find((item) => item.id === params[0]);
            if (row && row.status === 'joined') row.status = 'started';
            return { rows: [] };
        }
        if (sql.includes('arena:load_session')) {
            return { rows: db.sessions.filter((row) => row.id === params[0] && row.user_id === params[1]) };
        }
        if (sql.includes('arena:session_segments')) {
            return {
                rows: db.segments.filter((row) => row.session_id === params[0]).sort((a, b) => a.sequence - b.sequence),
            };
        }
        if (sql.includes('arena:load_segment')) {
            return {
                rows: db.segments.filter((row) => row.session_id === params[0] && row.sequence === params[1]),
            };
        }
        if (sql.includes('arena:complete_segment')) {
            const row = db.segments.find((item) => item.session_id === params[0] && item.sequence === params[1] && item.status === 'active');
            if (row) {
                row.status = 'completed';
                row.completed_at = nowIso();
                row.elapsed_ms = params[2];
                row.athlete_decision = params[3];
                row.started_at = row.started_at || params[4];
            }
            return { rows: [] };
        }
        if (sql.includes('arena:activate_segment')) {
            const row = db.segments.find((item) => item.session_id === params[0] && item.sequence === params[1] && item.status === 'pending');
            if (row) {
                row.status = 'active';
                row.started_at = nowIso();
            }
            return { rows: [] };
        }
        if (sql.includes('arena:advance_session')) {
            const row = db.sessions.find((item) => item.id === params[0] && item.status === 'active');
            if (row) row.current_sequence = params[1];
            return { rows: [] };
        }
        if (sql.includes('arena:finish_session')) {
            const row = db.sessions.find((item) => item.id === params[0] && item.status === 'active');
            if (row) {
                row.status = 'completed';
                row.finished_at = nowIso();
            }
            return { rows: [] };
        }
        if (sql.includes('arena:mark_completed')) {
            const row = db.participants.find((item) => item.id === params[0]);
            if (row) row.status = 'completed';
            return { rows: [] };
        }
        if (sql.includes('arena:insert_result')) {
            const row = {
                id: nextId('res'),
                session_id: params[0],
                user_id: params[1],
                event_id: params[2],
                event_version_id: params[3],
                total_elapsed_ms: params[4],
                result_status: 'unverified',
                evidence_source: 'virtual_session',
                evidence_confidence: 'LOW',
                competitive_eligible: false,
                created_at: nowIso(),
            };
            db.results.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:audit_result')) {
            db.audits.push({ result_id: params[0], actor: params[1], action: 'virtual_finish' });
            return { rows: [] };
        }
        if (sql.includes('arena:load_result')) {
            return { rows: db.results.filter((row) => row.session_id === params[0]) };
        }
        if (sql.includes('arena:abandon_session')) {
            const row = db.sessions.find((item) => item.id === params[0] && ['prepared', 'active', 'held'].includes(item.status));
            if (row) {
                row.status = 'abandoned';
                row.abandoned_at = nowIso();
            }
            return { rows: [] };
        }
        if (sql.includes('arena:mark_withdrawn')) {
            const row = db.participants.find((item) => item.id === params[0]);
            if (row && ['joined', 'started'].includes(row.status)) row.status = 'withdrawn';
            return { rows: [] };
        }
        if (sql.includes('arena:history_item') || sql.includes('arena:history')) {
            const rows = db.sessions
                .filter((session) => session.user_id === params[0] || (sql.includes('arena:history_item') && session.id === params[0] && session.user_id === params[1]))
                .map((session) => {
                    const event = db.events.find((item) => item.id === session.event_id);
                    const result = db.results.find((item) => item.session_id === session.id);
                    return {
                        ...session,
                        title: event?.title,
                        image_key: event?.image_key,
                        event_id: session.event_id,
                        starts_at: event?.starts_at,
                        ends_at: event?.ends_at,
                        event_starts_at: event?.starts_at,
                        event_ends_at: event?.ends_at,
                        category: event?.category,
                        session_status: session.status,
                        result_id: result?.id,
                        total_elapsed_ms: result?.total_elapsed_ms,
                        result_status: result?.result_status,
                        evidence_source: result?.evidence_source,
                        evidence_confidence: result?.evidence_confidence,
                        competitive_eligible: result?.competitive_eligible,
                    };
                });
            return { rows };
        }
        if (sql.includes('arena:leaderboard')) {
            return {
                rows: db.results
                    .filter(
                        (row) =>
                            row.event_id === params[0] &&
                            row.event_version_id === params[1] &&
                            row.competitive_eligible === true &&
                            ['verified', 'standard'].includes(row.result_status)
                    )
                    .sort((a, b) => a.total_elapsed_ms - b.total_elapsed_ms)
                    .map((row) => {
                        const user = db.users.find((item) => item.id === row.user_id);
                        return { ...row, display_name: user?.display_name, gender: user?.gender };
                    }),
            };
        }
        if (sql.includes('INSERT INTO athlete_dna') || sql.includes('UPDATE athlete_dna')) {
            db.dnaWrites += 1;
            return { rows: [] };
        }
        if (sql.includes('xp_ledger')) {
            db.xpWrites += 1;
            return { rows: [] };
        }
        if (sql.includes('engine:identity') || sql.includes('engine:cluster_xp')) {
            return { rows: [] };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };

    function addEvent(overrides = {}) {
        const event = {
            id: nextId('event'),
            slug: overrides.slug || `event-${db.seq}`,
            title: overrides.title || 'Coastal Hybrid Challenge',
            description: 'Versioned hybrid simulation.',
            image_key: 'arena/coastal.png',
            location: 'Sydney',
            event_type: 'simulation',
            division: 'open',
            category: 'hybrid',
            difficulty: null,
            club_id: overrides.club_id || null,
            status: 'open',
            starts_at: '2026-11-01T00:00:00.000Z',
            ends_at: '2026-11-30T00:00:00.000Z',
            published_at: nowIso(),
            ...overrides,
        };
        db.events.push(event);
        const version = {
            id: nextId('ver'),
            event_id: event.id,
            version_no: 1,
            format_key: 'hybrid_endurance_v1',
            estimated_duration_ms: 9736000,
            frozen_at: nowIso(),
            rules: {
                aboutRules: 'Eight runs and eight stations in a fixed order.',
                overview: 'Eight runs and eight stations in a fixed order.',
                generalRules: [
                    'Complete every published station before the cutoff.',
                    'No skipping stations on this event.',
                ],
                formatSummary: 'Independent ROXCLUB hybrid simulation.',
                orderFixed: true,
                movementStandards: ['Complete stations in published order'],
                requiredWork: ['Distances and repetitions are event-version specific'],
                evidence: { required: true, virtualCannotCreateRealWorldEvidence: true },
                roxzone: { timingDefined: false },
                penalties: [],
            },
        };
        db.versions.push(version);
        for (const station of STATIONS) {
            db.stations.push({ ...station, version_id: version.id, instructions: '', load_kg: null });
        }
        return event;
    }

    const opts = { query, now: db.now };
    return { db, opts, addEvent, nextId };
}

test('Arena Home returns a valid empty catalog', async () => {
    const { opts } = harness();
    const home = await getArenaHome('missing', { ...opts, query: async (sql, params) => {
        if (sql.includes('arena:load_user')) {
            return { rows: [{ id: 'a1', display_name: 'A', gender: 'female', account_type: 'athlete', onboarding_completed: true }] };
        }
        return opts.query(sql, params);
    } });
    assert.deepEqual(home.featured, []);
    assert.deepEqual(home.events, []);
    assert.equal(home.shortcuts.leaderboard, '/api/arena/leaderboard');
    assert.equal(home.simulationEngine.available, false);
});

test('missing arena tables return an empty home instead of a server error', async () => {
    const query = async (sql) => {
        if (sql.includes('arena:load_user')) {
            return {
                rows: [{ id: 'a1', display_name: 'A', gender: 'female', account_type: 'athlete', onboarding_completed: true }],
            };
        }
        const error = new Error('relation "arena_events" does not exist');
        error.code = '42P01';
        throw error;
    };
    const home = await getArenaHome('a1', { query, now: new Date('2026-11-02T12:00:00Z') });
    assert.deepEqual(home.featured, []);
    assert.deepEqual(home.events, []);
    assert.equal(home.eligibility.onboardingCompleted, true);
    assert.equal(home.simulationEngine.available, false);
});

test('missing arena tables return empty history and not-found details', async () => {
    const query = async () => {
        const error = new Error('relation "arena_events" does not exist');
        error.code = '42P01';
        throw error;
    };
    const history = await getHistory('a1', { query });
    assert.deepEqual(history.races, []);
    await assert.rejects(
        () => getEvent('missing', 'a1', { query }),
        (error) => error.code === 'EVENT_NOT_FOUND' && error.status === 404
    );
    await assert.rejects(
        () => getSession('a1', 'missing', { query }),
        (error) => error.code === 'SESSION_NOT_FOUND' && error.status === 404
    );
});

test('empty event catalog works', async () => {
    const { opts } = harness();
    const listed = await listEvents(opts);
    assert.deepEqual(listed.events, []);
});

test('challenge details return the current event version', async () => {
    const { opts, addEvent } = harness();
    const event = addEvent();
    const details = await getEvent(event.id, null, opts);
    assert.equal(details.event.versionNo, 1);
    assert.equal(details.event.format.key, 'hybrid_endurance_v1');
    assert.equal(details.event.tabs.includes('rules'), true);
});

test('full rules return ordered stations', async () => {
    const { opts, addEvent } = harness();
    const event = addEvent();
    const rules = await getEventRules(event.id, opts);
    assert.equal(rules.screenTitle, 'Full Race Rules');
    assert.equal(rules.title, 'Coastal Hybrid Challenge');
    assert.equal(rules.aboutRules, 'Eight runs and eight stations in a fixed order.');
    assert.deepEqual(rules.generalRules, [
        'Complete every published station before the cutoff.',
        'No skipping stations on this event.',
    ]);
    assert.equal(rules.stations.length, 8);
    assert.equal(rules.stations[0].title, 'Ski Ergometer');
    assert.equal(rules.stations[0].value, '1 km');
    assert.equal(rules.stations[7].title, 'Wall Balls');
    assert.equal(rules.stations[7].value, '100 reps');
    assert.deepEqual(
        rules.categoryLoads.columns.map((column) => column.label),
        ['Station', 'Open Men', 'Open Women', 'Doubles']
    );
    assert.deepEqual(rules.categoryLoads.rows, []);
});

test('unauthenticated strategy update is rejected', async () => {
    const res = {
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
    await PutArenaStrategy({ user: null, params: { id: 'event-1' }, body: { goalTime: '02:42:16' } }, res);
    assert.equal(res.statusCode, 401);
});

test('an athlete can save goal time, run pace, and station targets', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'Atif', gender: 'male', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    const saved = await saveStrategy(
        'a1',
        event.id,
        {
            goalTime: '02:42:16',
            runPace: '02:42',
            pacingStrategy: 'target',
            stationTargets: { ski_erg: '04:10' },
        },
        opts
    );
    assert.equal(saved.goalTime.clock, '02:42:16');
    assert.equal(saved.runPace.clock, '02:42');
    assert.equal(saved.stationTargets.ski_erg.targetMs, 250000);
    assert.equal(saved.racePlan[0].title, 'Run 1');
    assert.equal(saved.racePlan[0].time.clock, '02:42');
    assert.equal(saved.racePlan[0].timeOfDay.clock, '00:02:42');
    assert.equal(saved.racePlan[1].key, 'ski_erg');
    assert.equal(saved.racePlan[1].time.clock, '04:10');
    assert.equal(saved.validation.predictionAvailable, false);
    assert.equal(saved.simulationEngine.available, false);
});

test('invalid goal or pace is rejected', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    await assert.rejects(() => saveStrategy('a1', event.id, { goalTime: '99:99' }, opts), (error) => error.code === 'INVALID_TIME');
    await assert.rejects(() => saveStrategy('a1', event.id, { runPace: '00:30' }, opts), (error) => error.code === 'INVALID_PACE');
});

test('duplicate event participation is handled safely', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    await assert.rejects(() => joinEvent('a1', event.id, opts), (error) => error.code === 'ALREADY_JOINED');
});

test('club membership is not required for an open public event', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent({ club_id: null });
    const joined = await joinEvent('a1', event.id, opts);
    assert.equal(joined.participant.status, 'joined');
    assert.equal(joined.programActiveDoesNotBlock, true);
});

test('one-active-program restriction does not block Arena', () => {
    assert.equal(newAssignmentBlock('some-arena-event'), null);
});

test('strategy auto-joins so the app does not need a join API', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'Atif', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    const saved = await saveStrategy('a1', event.id, { goalTime: '02:42:16' }, opts);
    assert.equal(saved.goalTime.clock, '02:42:16');
    assert.equal(db.participants.length, 1);
    assert.equal(db.participants[0].user_id, 'a1');
});

test('an athlete cannot edit another athlete strategy', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push(
        { id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true },
        { id: 'a2', display_name: 'B', account_type: 'athlete', onboarding_completed: true }
    );
    const event = addEvent();
    await saveStrategy('a1', event.id, { goalTime: '02:42:16' }, opts);
    const second = await saveStrategy('a2', event.id, { goalTime: '02:00:00' }, opts);
    assert.equal(second.goalTime.clock, '02:00:00');
    const first = await getStrategy('a1', event.id, opts);
    assert.equal(first.goalTime.clock, '02:42:16');
});

test('a race session cannot be started twice and reconnect is authoritative', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    db.dna.push({ user_id: 'a1', status: 'CALIBRATING', strength: 40, engine: 40, endurance: 40, power: 40, mobility: 40 });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    const session = await startEvent('a1', event.id, opts);
    assert.equal(session.status, 'active');
    await assert.rejects(() => startEvent('a1', event.id, opts), (error) => error.code === 'SESSION_ACTIVE');
    const again = await getSession('a1', session.id, opts);
    assert.equal(again.status, 'active');
    assert.equal(again.startedAt, session.startedAt);
    assert.equal(again.engine.available, false);
});

test('session transitions, duplicate finish, and abandoned races stay unofficial', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', gender: 'male', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    const session = await startEvent('a1', event.id, opts);
    const moved = await checkpoint('a1', session.id, { sequence: 1, decision: 'hold' }, opts);
    assert.equal(moved.currentSequence, 2);
    const finished = await finishSession('a1', session.id, opts);
    assert.equal(finished.result.status, 'unverified');
    assert.equal(finished.result.competitiveEligible, false);
    assert.equal(finished.officialRanking, false);
    const again = await finishSession('a1', session.id, opts);
    assert.equal(again.idempotent, true);
    const history = await getHistory('a1', opts);
    assert.equal(history.races[0].officialCompleted, false);

    const second = addEvent({ slug: 'leave-race', title: 'Leave Race' });
    db.users.push({ id: 'a2', display_name: 'B', account_type: 'athlete', onboarding_completed: true });
    await joinEvent('a2', second.id, opts);
    const live = await startEvent('a2', second.id, opts);
    const left = await abandonSession('a2', live.id, opts);
    assert.equal(left.officialCompleted, false);
    const abandonedHistory = await getHistory('a2', opts);
    assert.equal(abandonedHistory.races[0].raceStatus, 'abandoned');
    assert.equal(abandonedHistory.races[0].officialCompleted, false);
});

test('unverified results cannot gain official ranking', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', gender: 'male', account_type: 'athlete', onboarding_completed: true });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    const session = await startEvent('a1', event.id, opts);
    await finishSession('a1', session.id, opts);
    const board = await getLeaderboard({ ...opts, queryParams: { eventId: event.id, division: 'men' } });
    assert.equal(board.entries.length, 0);
    assert.equal(board.comparable, true);
});

test('virtual race does not modify real Athlete DNA', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    db.dna.push({ user_id: 'a1', status: 'CALIBRATING', strength: 12 });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    const session = await startEvent('a1', event.id, opts);
    await finishSession('a1', session.id, opts);
    assert.equal(db.dnaWrites, 0);
    assert.equal(db.xpWrites, 0);
    assert.equal(db.dna[0].strength, 12);
});

test('legacy onboarding program blockers are unchanged', () => {
    const block = newAssignmentBlock('race_build_12w');
    assert.equal(block.productCode, 'PRODUCT_CONFIGURATION_BLOCKER');
});

test('Arena start snapshots shared athlete engine inputs without numeric simulation', async () => {
    const { db, opts, addEvent } = harness();
    db.users.push({ id: 'a1', display_name: 'A', account_type: 'athlete', onboarding_completed: true });
    db.dna.push({ user_id: 'a1', status: 'CALIBRATING', model_version: 'v0', strength: null, engine: null, endurance: null, power: null, mobility: null });
    db.proficiency.push({
        user_id: 'a1',
        station_key: 'ski_erg',
        evidence_count: 2,
        status: 'CALIBRATING',
        score: null,
        score_status: 'PENDING_MODEL',
        model_version: 'pending_v0',
        last_evidence_status: 'STANDARD',
    });
    db.activities.push({
        id: 'act-1',
        user_id: 'a1',
        source: 'ROXCLUB_NATIVE',
        activity_type: 'running',
        evidence_status: 'STANDARD',
        duration_sec: 1200,
        distance_m: 5000,
        start_at: '2026-11-01T08:00:00Z',
    });
    const event = addEvent();
    await joinEvent('a1', event.id, opts);
    await saveStrategy('a1', event.id, { pacingStrategy: 'conservative' }, opts);
    const session = await startEvent('a1', event.id, opts);
    assert.equal(session.engine.available, false);
    assert.equal(session.evidenceSnapshot.athleteDna.status, 'CALIBRATING');
    assert.equal(session.evidenceSnapshot.athleteDna.visibleNumeric, false);
    assert.equal(session.evidenceSnapshot.stationProficiency[0].key, 'ski_erg');
    assert.equal(session.evidenceSnapshot.stationProficiency[0].score, null);
    assert.equal(session.evidenceSnapshot.athleteDna.attributes.speed.current, null);
    assert.equal(session.evidenceSnapshot.athleteDna.attributes.speed.pending, true);
    assert.equal(session.evidenceSnapshot.athleteDna.legacy.mobility.notSpeed, true);
    assert.equal(session.evidenceSnapshot.pacingStrategy, 'conservative');
    assert.equal(session.evidenceSnapshot.runningEvidence.activityCount, 1);
    assert.equal(session.evidenceSnapshot.fatigueModel.available, false);
    assert.equal(session.engine.inputs.stationProficiency, 'present');
});
