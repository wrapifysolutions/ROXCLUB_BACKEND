const test = require('node:test');
const assert = require('node:assert/strict');
const { getArenaHome } = require('../lib/arena/arenaService');
const {
    createCoachEvent,
    listCoachEvents,
    listAdminEvents,
    reviewCoachEvent,
} = require('../lib/arena/eventPublishService');

function completeEvent(overrides = {}) {
    return {
        title: 'Berlin Hybrid Challenge',
        description: 'Eight runs and eight stations in a fixed independent ROXCLUB order.',
        imageKey: 'arena/berlin.png',
        location: 'Berlin',
        startsAt: '2026-12-11T00:00:00.000Z',
        endsAt: '2026-12-13T23:59:59.000Z',
        eventType: 'simulation',
        sportType: 'Hybrid',
        division: 'open',
        category: 'hybrid',
        difficulty: 'intermediate',
        visibility: 'public',
        timezone: 'Europe/Berlin',
        ...overrides,
    };
}

function harness() {
    const db = {
        seq: 1,
        users: [
            { id: 'coach-1', account_type: 'coach' },
            { id: 'admin-1', account_type: 'admin' },
            { id: 'athlete-1', account_type: 'athlete', onboarding_completed: true, display_name: 'Alex', gender: 'male' },
        ],
        applications: [{ user_id: 'coach-1', status: 'approved', created_at: '2026-01-01' }],
        events: [],
        versions: [],
        stations: [],
    };
    const nextId = (prefix) => `${prefix}-${db.seq++}`;
    const query = async (sql, params = []) => {
        if (sql.includes('coach:latest_status')) {
            return { rows: db.applications.filter((row) => row.user_id === params[0]) };
        }
        if (sql.includes('admin:load_actor')) {
            return { rows: db.users.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('arena:load_user')) {
            return { rows: db.users.filter((row) => row.id === params[0]) };
        }
        if (sql.includes('arena:list_events')) {
            return {
                rows: db.events
                    .filter((event) => event.status !== 'draft' && event.published_at)
                    .map((event) => {
                        const version = db.versions.filter((row) => row.event_id === event.id).at(-1);
                        return { ...event, version_id: version?.id, version_no: version?.version_no };
                    }),
            };
        }
        if (sql.includes('arena:coach_insert_event')) {
            const row = {
                id: nextId('event'),
                slug: params[0],
                title: params[1],
                description: params[2],
                image_key: params[3],
                location: params[4],
                event_type: params[5],
                division: params[6],
                category: params[7],
                difficulty: params[8],
                club_id: params[9],
                created_by_user_id: params[10],
                review_status: 'pending',
                status: 'draft',
                starts_at: params[11],
                ends_at: params[12],
                sport_type: params[13] || null,
                visibility: params[14] || 'public',
                timezone: params[15] || 'UTC',
                max_participants: params[16] || null,
                published_at: null,
            };
            db.events.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:coach_insert_version')) {
            const row = {
                id: nextId('ver'),
                event_id: params[0],
                version_no: 1,
                format_key: params[1],
                estimated_duration_ms: params[2],
                rules: typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3],
            };
            db.versions.push(row);
            return { rows: [row] };
        }
        if (sql.includes('arena:coach_insert_station')) {
            db.stations.push({
                version_id: params[0],
                sequence: params[1],
                station_key: params[3],
                title: params[4],
            });
            return { rows: [] };
        }
        if (sql.includes('arena:coach_list_events')) {
            return {
                rows: db.events
                    .filter((event) => event.created_by_user_id === params[0])
                    .map((event) => {
                        const version = db.versions.filter((row) => row.event_id === event.id).at(-1);
                        return { ...event, version_id: version?.id, version_no: version?.version_no };
                    }),
            };
        }
        if (sql.includes('arena:admin_list_events')) {
            return {
                rows: db.events
                    .filter((event) => params[0] === 'all' || event.review_status === params[0])
                    .map((event) => {
                        const version = db.versions.filter((row) => row.event_id === event.id).at(-1);
                        return { ...event, version_id: version?.id, version_no: version?.version_no };
                    }),
            };
        }
        if (sql.includes('arena:admin_load_event')) {
            return { rows: db.events.filter((event) => event.id === params[0]) };
        }
        if (sql.includes('arena:admin_publish')) {
            const event = db.events.find((row) => row.id === params[0]);
            event.review_status = 'approved';
            event.status = params[2];
            event.published_at = '2026-11-03T06:00:00.000Z';
            event.reviewed_by = params[1];
            return { rows: [event] };
        }
        if (sql.includes('arena:admin_reject')) {
            const event = db.events.find((row) => row.id === params[0]);
            event.review_status = 'rejected';
            event.status = 'draft';
            event.published_at = null;
            event.rejection_reason = params[2];
            return { rows: [event] };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    const opts = { query, now: new Date('2026-11-03T06:00:00Z') };
    return { db, opts };
}

test('incomplete coach event form is rejected with field names', async () => {
    const { opts } = harness();
    await assert.rejects(
        () => createCoachEvent('coach-1', { title: 'Berlin' }, opts),
        (error) =>
            error.code === 'INVALID_EVENT' &&
            error.fields.includes('description') &&
            error.fields.includes('imageKey') &&
            error.fields.includes('eventType')
    );
});

test('unapproved coach cannot submit an Arena event', async () => {
    const { db, opts } = harness();
    db.applications = [];
    await assert.rejects(
        () => createCoachEvent('coach-1', completeEvent({ title: 'Tokyo Speed League' }), opts),
        (error) => error.code === 'COACH_NOT_APPROVED'
    );
});

test('coach form submission stays hidden until admin publishes', async () => {
    const { opts } = harness();
    const created = await createCoachEvent(
        'coach-1',
        completeEvent({
            title: 'Tokyo Speed League',
            location: 'Tokyo',
            startsAt: '2026-11-01T00:00:00.000Z',
            endsAt: '2026-11-20T23:59:59.000Z',
        }),
        opts
    );
    assert.equal(created.event.reviewStatus, 'pending');
    assert.equal(created.visibleToAthletes, false);

    const before = await getArenaHome('athlete-1', opts);
    assert.equal(before.events.length, 0);

    const pending = await listAdminEvents('admin-1', 'pending', opts);
    assert.equal(pending.events.length, 1);

    const published = await reviewCoachEvent('admin-1', created.event.id, 'publish', {}, opts);
    assert.equal(published.visibleToAthletes, true);

    const home = await getArenaHome('athlete-1', opts);
    assert.equal(home.events.length, 1);
    assert.equal(home.events[0].title, 'Tokyo Speed League');
    assert.equal(home.featured[0].title, 'Tokyo Speed League');
});

test('partial station payload fills the default hybrid course', async () => {
    const { opts } = harness();
    const created = await createCoachEvent(
        'coach-1',
        completeEvent({
            stations: [
                { sequence: 2, key: 'ski_erg', title: 'Ski Ergometer', distanceM: 1000 },
                { sequence: 4, key: 'sled_push', title: 'Sled Push', distanceM: 50 },
                { sequence: 16, key: 'wall_balls', title: 'Wall Balls', repetitions: 100 },
            ],
        }),
        opts
    );
    assert.equal(created.event.stations.length, 16);
    const sled = created.event.stations.find((row) => row.key === 'sled_push');
    const wall = created.event.stations.find((row) => row.key === 'wall_balls');
    const run = created.event.stations.find((row) => row.key === 'run_1');
    assert.equal(sled.loadKg, 50);
    assert.equal(sled.distanceM, 50);
    assert.equal(wall.repetitions, 100);
    assert.equal(wall.loadKg, 6);
    assert.equal(run.distanceM, 1000);
    assert.equal(Boolean(sled.instructions), true);
});

test('coach rules are stored on that event only', async () => {
    const { db, opts } = harness();
    const tokyo = await createCoachEvent(
        'coach-1',
        completeEvent({
            title: 'Tokyo Speed League',
            location: 'Tokyo',
            aboutRules: 'Tokyo cutoff and station order for this league only.',
            generalRules: ['Finish SkiErg before the first sled.', 'No drafting on the run.'],
            categoryLoads: [
                { station: 'Sled Push', openMen: '50 kg', openWomen: '30 kg', doubles: '40 kg' },
            ],
            penalties: ['10 seconds for a no-rep'],
        }),
        opts
    );
    const berlin = await createCoachEvent(
        'coach-1',
        completeEvent({
            aboutRules: 'Berlin hybrid rules for this weekend only.',
            generalRules: ['Wall balls last.', 'Roxzone is untimed.'],
        }),
        opts
    );
    const tokyoRules = db.versions.find((row) => row.event_id === tokyo.event.id).rules;
    const berlinRules = db.versions.find((row) => row.event_id === berlin.event.id).rules;
    assert.equal(tokyoRules.aboutRules, 'Tokyo cutoff and station order for this league only.');
    assert.deepEqual(tokyoRules.generalRules, [
        'Finish SkiErg before the first sled.',
        'No drafting on the run.',
    ]);
    assert.deepEqual(tokyoRules.penalties, ['10 seconds for a no-rep']);
    assert.equal(tokyoRules.categoryLoads[0].openMen, '50 kg');
    assert.equal(berlinRules.aboutRules, 'Berlin hybrid rules for this weekend only.');
    assert.deepEqual(berlinRules.generalRules, ['Wall balls last.', 'Roxzone is untimed.']);
    assert.notEqual(tokyoRules.aboutRules, berlinRules.aboutRules);
});

test('rejected coach events do not appear on athlete Arena Home', async () => {
    const { opts } = harness();
    const created = await createCoachEvent(
        'coach-1',
        completeEvent({ title: 'New York Urban Race', location: 'New York' }),
        opts
    );
    await reviewCoachEvent('admin-1', created.event.id, 'reject', { reason: 'Incomplete stations' }, opts);
    const home = await getArenaHome('athlete-1', opts);
    assert.equal(home.events.length, 0);
    const mine = await listCoachEvents('coach-1', opts);
    assert.equal(mine.events[0].reviewStatus, 'rejected');
});
