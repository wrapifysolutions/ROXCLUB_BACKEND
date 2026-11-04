const test = require('node:test');
const assert = require('node:assert/strict');
const {
    orderedPair,
    proposeIdentityLinks,
    associateNativeMatches,
    clusterAlreadyAwardedXp,
    collapseAssociated,
    linkStatus,
} = require('../lib/athlete/identityLinks');
const { upsertCanonicalImportedActivity } = require('../lib/athlete/canonicalActivity');
const { createRateLimit } = require('../lib/http/rateLimit');

function memory() {
    const db = {
        activities: [],
        links: [],
        xp: [],
    };
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
            return {
                rows: db.activities.filter((row) => row.id === params[0] || row.id === params[1]),
            };
        }
        if (sql.includes('engine:identity_neighbors')) {
            return {
                rows: db.activities.filter(
                    (row) => row.user_id === params[0] && row.id !== params[1] && row.start_at >= params[2] && row.start_at <= params[3]
                ),
            };
        }
        if (sql.includes('engine:identity_by_external')) {
            return {
                rows: db.activities.filter(
                    (row) =>
                        row.user_id === params[0] &&
                        String(row.source).toUpperCase() === String(params[1]).toUpperCase() &&
                        String(row.external_id) === String(params[2])
                ),
            };
        }
        if (sql.includes('engine:insert_identity_link')) {
            const existing = db.links.find((row) => row.activity_a === params[0] && row.activity_b === params[1]);
            if (existing) {
                if (existing.status === 'rejected') return { rows: [existing] };
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
        if (sql.includes('engine:identity_links_for_user')) {
            return { rows: db.links.filter((row) => row.user_id === params[0] && row.status === 'associated') };
        }
        throw new Error(`Unhandled SQL ${sql}`);
    };
    return { db, query };
}

test('native and import become associated without merging provider rows', async () => {
    const { db, query } = memory();
    const imported = await upsertCanonicalImportedActivity(
        'u1',
        {
            source: 'STRAVA',
            externalId: 's1',
            activityType: 'Run',
            startAt: '2026-11-02T08:00:00.000Z',
            durationSec: 1800,
            distanceM: 5000,
        },
        query
    );
    db.activities.push({
        id: 'native-1',
        user_id: 'u1',
        source: 'ROXCLUB_NATIVE',
        activity_type: 'running',
        start_at: '2026-11-02T08:00:00.000Z',
        duration_sec: 1800,
    });
    const links = await associateNativeMatches('u1', 'native-1', [{ source: 'strava', externalId: 's1' }], query);
    assert.equal(imported, 'act-1');
    assert.equal(db.activities.length, 2);
    assert.equal(links[0].status, 'associated');
    assert.equal(db.activities.some((row) => row.source === 'STRAVA'), true);
    assert.equal(db.activities.some((row) => row.source === 'ROXCLUB_NATIVE'), true);
});

test('two provider copies stay as two rows and associate for XP/feed collapse', async () => {
    const { db, query } = memory();
    await upsertCanonicalImportedActivity(
        'u1',
        { source: 'STRAVA', externalId: 's1', activityType: 'Run', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800 },
        query
    );
    await upsertCanonicalImportedActivity(
        'u1',
        { source: 'ZEPP', externalId: 'z1', activityType: 'Run', startAt: '2026-11-02T08:01:00.000Z', durationSec: 1800 },
        query
    );
    assert.equal(linkStatus('STRAVA', 'ZEPP'), 'associated');
    assert.equal(db.links.every((row) => row.status === 'associated'), true);
    assert.equal(db.activities.length, 2);
});

test('replay of the same provider id does not create a second canonical row or second link', async () => {
    const { db, query } = memory();
    const first = await upsertCanonicalImportedActivity(
        'u1',
        { source: 'STRAVA', externalId: 's1', activityType: 'Run', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800 },
        query
    );
    const second = await upsertCanonicalImportedActivity(
        'u1',
        { source: 'STRAVA', externalId: 's1', activityType: 'Run', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1820 },
        query
    );
    assert.equal(first, second);
    assert.equal(db.activities.length, 1);
});

test('concurrent identity inserts keep a single ordered pair', async () => {
    const { query, db } = memory();
    db.activities.push(
        { id: 'a', user_id: 'u1', source: 'STRAVA', activity_type: 'running', start_at: '2026-11-02T08:00:00.000Z', duration_sec: 1800 },
        { id: 'b', user_id: 'u1', source: 'ZEPP', activity_type: 'running', start_at: '2026-11-02T08:00:00.000Z', duration_sec: 1800 }
    );
    await Promise.all([
        proposeIdentityLinks('u1', { id: 'a', source: 'STRAVA', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'running' }, query),
        proposeIdentityLinks('u1', { id: 'b', source: 'ZEPP', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'running' }, query),
    ]);
    assert.equal(db.links.length, 1);
    assert.deepEqual(orderedPair('b', 'a'), ['a', 'b']);
});

test('associated cluster XP is not awarded twice and Arena evidence collapses to one row', async () => {
    const { db, query } = memory();
    db.links.push({ activity_a: 'native-1', activity_b: 'strava-1', user_id: 'u1', status: 'associated' });
    db.xp.push({ activity_id: 'native-1', xp: 50 });
    assert.equal(await clusterAlreadyAwardedXp('u1', 'strava-1', query), true);
    const collapsed = collapseAssociated(
        [
            { id: 'native-1', source: 'ROXCLUB_NATIVE', type: 'running' },
            { id: 'strava-1', source: 'STRAVA', type: 'running' },
        ],
        db.links
    );
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].source, 'ROXCLUB_NATIVE');
});

test('transitive associated links collapse to one Arena evidence row', () => {
    const collapsed = collapseAssociated(
        [
            { id: 'a', source: 'ROXCLUB_NATIVE', type: 'running' },
            { id: 'b', source: 'STRAVA', type: 'running' },
            { id: 'c', source: 'ZEPP', type: 'running' },
        ],
        [
            { activity_a: 'a', activity_b: 'b', status: 'associated' },
            { activity_a: 'b', activity_b: 'c', status: 'associated' },
        ]
    );
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].id, 'a');
});

test('unresolved links do not merge and rejected links stay rejected', async () => {
    const { db, query } = memory();
    db.activities.push(
        { id: 'a', user_id: 'u1', source: 'STRAVA', activity_type: 'running', start_at: '2026-11-02T08:00:00.000Z', duration_sec: 1800 },
        { id: 'b', user_id: 'u1', source: 'ZEPP', activity_type: 'running', start_at: '2026-11-02T08:00:00.000Z', duration_sec: 1800 }
    );
    db.links.push({ activity_a: 'a', activity_b: 'b', user_id: 'u1', status: 'rejected' });
    const { proposeIdentityLinks } = require('../lib/athlete/identityLinks');
    await proposeIdentityLinks(
        'u1',
        { id: 'a', source: 'STRAVA', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'running' },
        query
    );
    assert.equal(db.links[0].status, 'rejected');
    assert.equal(db.activities.length, 2);
});

test('cross-athlete identity links are rejected', async () => {
    const query = async (sql) => {
        if (sql.includes('engine:identity_by_external')) {
            return { rows: [{ id: 'theirs', source: 'STRAVA' }] };
        }
        if (sql.includes('engine:identity_owners')) {
            return {
                rows: [
                    { id: 'mine', user_id: 'u1' },
                    { id: 'theirs', user_id: 'u2' },
                ],
            };
        }
        throw new Error(sql);
    };
    await assert.rejects(
        () => associateNativeMatches('u1', 'mine', [{ source: 'STRAVA', externalId: 's9' }], query),
        (error) => error.code === 'IDENTITY_CROSS_ATHLETE'
    );
});

test('missing identity tables fail closed instead of awarding XP', async () => {
    const query = async (sql) => {
        if (sql.includes('engine:cluster_xp')) {
            const error = new Error('missing');
            error.code = '42P01';
            throw error;
        }
        throw new Error(sql);
    };
    await assert.rejects(
        () => clusterAlreadyAwardedXp('u1', 'act-1', query),
        (error) => error.code === 'DATABASE_NOT_READY' && error.status === 503
    );
});

test('rate limiter is disabled in tests and isolates keys', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const limit = createRateLimit({ windowMs: 60000, max: 1, name: 't' });
        const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
        let nexts = 0;
        limit({ user: { id: 'a' }, ip: '1' }, res, () => { nexts += 1; });
        limit({ user: { id: 'a' }, ip: '1' }, res, () => { nexts += 1; });
        assert.equal(nexts, 1);
        assert.equal(res.statusCode, 429);
        const other = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
        limit({ user: { id: 'b' }, ip: '2' }, other, () => { nexts += 1; });
        assert.equal(nexts, 2);
    } finally {
        process.env.NODE_ENV = previous;
    }
});
