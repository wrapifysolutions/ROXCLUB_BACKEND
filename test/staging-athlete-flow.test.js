const test = require('node:test');
const assert = require('node:assert/strict');
const { stagingIntegrationAllowed } = require('../lib/migrations/env');
const {
    ATHLETE_FLOW_STEPS,
    STAGING_SQL_CHECKS,
    assertVirtualRaceDisabled,
} = require('../lib/staging/athleteFlowPlan');
const { collapseAssociated, clusterAlreadyAwardedXp } = require('../lib/athlete/identityLinks');
const { upsertCanonicalImportedActivity } = require('../lib/athlete/canonicalActivity');

test('athlete flow plan covers signup through race history and SQL checks', () => {
    assert.deepEqual(
        ATHLETE_FLOW_STEPS.map((step) => step.id),
        [
            'signup',
            'onboarding',
            'workout',
            'canonical_activity',
            'xp',
            'dna_evidence',
            'station_proficiency',
            'readiness',
            'arena_snapshot',
            'race_history',
        ]
    );
    for (const step of ATHLETE_FLOW_STEPS) {
        assert.ok(STAGING_SQL_CHECKS[step.id], step.id);
    }
    assert.equal(assertVirtualRaceDisabled({ available: false }), true);
    assert.equal(assertVirtualRaceDisabled({ available: true }), false);
});

test('in-memory athlete flow keeps canonical rows, XP uniqueness, and cross-athlete isolation', async () => {
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
            if (existing) return { rows: [{ id: existing.id }] };
            const row = {
                id: `act-${db.activities.length + 1}`,
                user_id: params[0],
                source: params[1],
                provenance: params[3],
                external_id: params[11],
            };
            db.activities.push(row);
            return { rows: [{ id: row.id }] };
        }
        if (sql.includes('engine:identity_neighbors') || sql.includes('engine:identity')) {
            return { rows: [] };
        }
        if (sql.includes('engine:cluster_xp')) {
            const linked = db.links.filter(
                (link) =>
                    link.user_id === params[0] &&
                    link.status === 'associated' &&
                    (link.activity_a === params[1] || link.activity_b === params[1])
            );
            const awarded = db.xp.find((row) =>
                linked.some((link) => row.activity_id === link.activity_a || row.activity_id === link.activity_b)
            );
            return { rows: awarded ? [{ activity_id: awarded.activity_id }] : [] };
        }
        throw new Error(sql);
    };

    const first = await upsertCanonicalImportedActivity(
        'athlete-a',
        { source: 'STRAVA', externalId: 's1', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'run' },
        query
    );
    const replay = await upsertCanonicalImportedActivity(
        'athlete-a',
        { source: 'STRAVA', externalId: 's1', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'run' },
        query
    );
    const other = await upsertCanonicalImportedActivity(
        'athlete-b',
        { source: 'STRAVA', externalId: 's1', startAt: '2026-11-02T08:00:00.000Z', durationSec: 1800, activityType: 'run' },
        query
    );
    assert.equal(first, replay);
    assert.notEqual(first, other);
    assert.equal(db.activities.filter((row) => row.user_id === 'athlete-a').length, 1);
    assert.equal(db.activities.filter((row) => row.user_id === 'athlete-b').length, 1);

    db.links.push({ activity_a: first, activity_b: 'native-a', user_id: 'athlete-a', status: 'associated' });
    db.xp.push({ activity_id: first, reason: 'session_complete', user_id: 'athlete-a' });
    assert.equal(await clusterAlreadyAwardedXp('athlete-a', 'native-a', query), true);
    assert.equal(await clusterAlreadyAwardedXp('athlete-b', other, query), false);

    const collapsed = collapseAssociated(
        [
            { id: first, source: 'STRAVA' },
            { id: 'native-a', source: 'ROXCLUB_NATIVE' },
            { id: other, source: 'STRAVA' },
        ],
        db.links
    );
    assert.equal(collapsed.filter((row) => row.id === other).length, 1);
    assert.equal(collapsed.filter((row) => row.id === first || row.id === 'native-a').length, 1);
});

const live = stagingIntegrationAllowed(process.env);

test('staging SQL athlete flow is not executed without an isolated staging database', () => {
    if (!live) {
        assert.equal(stagingIntegrationAllowed(process.env), false);
        return;
    }
    assert.equal(live, true);
});

test(
    'staging signup-to-race-history SQL verification',
    { skip: live ? false : 'no isolated staging database (ROXCLUB_ENV=staging, STAGING_INTEGRATION=true, distinct POSTGRES_SQL_URL_STAGING)' },
    async () => {
        const { Client } = require('pg');
        const { resolveMigrateTarget } = require('../lib/migrations/env');
        const target = resolveMigrateTarget(process.env, ['--staging']);
        const client = new Client({ connectionString: target.connectionString, connectionTimeoutMillis: 5000 });
        await client.connect();
        try {
            const migrations = await client.query('SELECT id, notes FROM schema_migrations ORDER BY id');
            const pending = await client.query(
                `SELECT id, status, reason FROM schema_migration_prerequisites WHERE status = 'unresolved'`
            );
            assert.ok(Array.isArray(migrations.rows));
            assert.equal(
                pending.rows.some((row) => row.id === '003_xp_ledger_activity_reason_unique' && row.status === 'unresolved'),
                pending.rows.some((row) => row.id === '003_xp_ledger_activity_reason_unique')
            );
        } finally {
            await client.end();
        }
    }
);
