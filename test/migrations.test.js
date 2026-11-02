const test = require('node:test');
const assert = require('node:assert/strict');
const { schemaMutationsAllowed, isProductionRuntime } = require('../lib/migrations/policy');
const {
    countDuplicateXp,
    runVersionedMigrations,
    XP_UNIQUE_MIGRATION_ID,
    IDENTITY_MIGRATION_ID,
    XP_UNIQUE_INDEX,
} = require('../lib/migrations/run');
const { resolveMigrateTarget, stagingIntegrationAllowed, connectionFingerprint } = require('../lib/migrations/env');
const { databaseNotReady } = require('../lib/db/errors');
const { queueActivityRecorded } = require('../lib/workout/activityJobs');

function cloneState(db) {
    return {
        tables: new Set(db.tables),
        indexes: new Set(db.indexes),
        migrations: db.migrations.map((row) => ({ ...row })),
        prerequisites: db.prerequisites.map((row) => ({ ...row, details: { ...row.details } })),
        xpDuplicates: db.xpDuplicates,
        xpLedger: db.xpLedger,
        interrupt: db.interrupt,
    };
}

function restoreState(db, snap) {
    db.tables = snap.tables;
    db.indexes = snap.indexes;
    db.migrations = snap.migrations;
    db.prerequisites = snap.prerequisites;
    db.xpDuplicates = snap.xpDuplicates;
    db.xpLedger = snap.xpLedger;
    db.interrupt = snap.interrupt;
}

function migrationMemory(seed = {}) {
    const db = {
        tables: new Set(seed.tables || []),
        indexes: new Set(seed.indexes || []),
        migrations: seed.migrations ? seed.migrations.map((row) => ({ ...row })) : [],
        prerequisites: seed.prerequisites ? seed.prerequisites.map((row) => ({ ...row })) : [],
        xpDuplicates: seed.xpDuplicates || 0,
        xpLedger: seed.xpLedger !== false,
        interrupt: seed.interrupt || null,
    };

    const query = async (sql, params = []) => {
        const text = String(sql);
        if (db.interrupt && text.includes(db.interrupt)) {
            const error = new Error('interrupted');
            error.code = 'MIGRATION_INTERRUPTED';
            throw error;
        }
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
            db.tables.add('schema_migrations');
            return { rows: [] };
        }
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migration_prerequisites')) {
            db.tables.add('schema_migration_prerequisites');
            return { rows: [] };
        }
        if (text.includes('ALTER TABLE schema_migrations')) return { rows: [] };
        if (text.includes('CREATE TABLE IF NOT EXISTS activity_identity_links')) {
            db.tables.add('activity_identity_links');
            return { rows: [] };
        }
        if (text.includes('activity_identity_links_user_idx')) {
            db.indexes.add('activity_identity_links_user_idx');
            return { rows: [] };
        }
        if (text.includes(XP_UNIQUE_INDEX) && text.includes('CREATE UNIQUE INDEX')) {
            db.indexes.add(XP_UNIQUE_INDEX);
            return { rows: [] };
        }
        if (text.includes('migrate:xp_duplicates')) {
            if (!db.xpLedger) {
                const error = new Error('missing xp_ledger');
                error.code = '42P01';
                throw error;
            }
            return { rows: [{ count: db.xpDuplicates }] };
        }
        if (text.includes('migrate:xp_index_exists')) {
            return { rows: db.indexes.has(params[0] || XP_UNIQUE_INDEX) ? [{ '?column?': 1 }] : [] };
        }
        if (text.includes('SELECT id FROM schema_migrations') && !text.includes('INSERT')) {
            return { rows: db.migrations.map((row) => ({ id: row.id })) };
        }
        if (text.includes('INSERT INTO schema_migrations')) {
            const existing = db.migrations.find((row) => row.id === params[0]);
            if (existing) existing.notes = params[1];
            else db.migrations.push({ id: params[0], notes: params[1] });
            return { rows: [] };
        }
        if (text.includes('DELETE FROM schema_migrations')) {
            db.migrations = db.migrations.filter((row) => row.id !== params[0]);
            return { rows: [] };
        }
        if (text.includes('migrate:upsert_prerequisite') || text.includes('INSERT INTO schema_migration_prerequisites')) {
            const details = typeof params[3] === 'string' ? JSON.parse(params[3]) : params[3] || {};
            const existing = db.prerequisites.find((row) => row.id === params[0]);
            if (existing) {
                existing.status = params[1];
                existing.reason = params[2];
                existing.details = details;
            } else {
                db.prerequisites.push({
                    id: params[0],
                    status: params[1],
                    reason: params[2],
                    details,
                });
            }
            return { rows: [] };
        }
        if (text.includes('FROM schema_migration_prerequisites')) {
            return {
                rows: db.prerequisites
                    .filter((row) => row.status === 'unresolved')
                    .map((row) => ({ ...row })),
            };
        }
        return { rows: [] };
    };

    const withTransaction = async (work) => {
        const snap = cloneState(db);
        try {
            return await work({ query });
        } catch (error) {
            restoreState(db, snap);
            throw error;
        }
    };

    const runStatementsOnClient = async () => {};

    return { db, query, withTransaction, runStatementsOnClient };
}

async function migrate(memory, extra = {}) {
    return runVersionedMigrations({
        force: true,
        baselineStatements: extra.baselineStatements || [],
        withTransaction: memory.withTransaction,
        runStatementsOnClient: memory.runStatementsOnClient,
    });
}

test('production API startup does not allow silent schema mutations', () => {
    const previous = {
        NODE_ENV: process.env.NODE_ENV,
        VERCEL: process.env.VERCEL,
        APPLY_SCHEMA_MIGRATIONS: process.env.APPLY_SCHEMA_MIGRATIONS,
        ALLOW_PRODUCTION_MIGRATIONS: process.env.ALLOW_PRODUCTION_MIGRATIONS,
    };
    try {
        process.env.NODE_ENV = 'production';
        delete process.env.VERCEL;
        delete process.env.APPLY_SCHEMA_MIGRATIONS;
        delete process.env.ALLOW_PRODUCTION_MIGRATIONS;
        assert.equal(isProductionRuntime(), true);
        assert.equal(schemaMutationsAllowed(), false);
        process.env.APPLY_SCHEMA_MIGRATIONS = 'true';
        assert.equal(schemaMutationsAllowed(), false);
        process.env.ALLOW_PRODUCTION_MIGRATIONS = 'true';
        assert.equal(schemaMutationsAllowed(), true);
    } finally {
        process.env.NODE_ENV = previous.NODE_ENV;
        process.env.VERCEL = previous.VERCEL;
        process.env.APPLY_SCHEMA_MIGRATIONS = previous.APPLY_SCHEMA_MIGRATIONS;
        process.env.ALLOW_PRODUCTION_MIGRATIONS = previous.ALLOW_PRODUCTION_MIGRATIONS;
    }
});

test('duplicate XP ledger groups are counted and not rewritten', async () => {
    const query = async () => ({ rows: [{ count: 3 }] });
    assert.equal(await countDuplicateXp(query), 3);
});

test('missing evidence tables fail the activity job instead of swallowing 42P01', async () => {
    const query = async () => {
        const error = new Error('missing');
        error.code = '42P01';
        throw error;
    };
    await assert.rejects(
        () => queueActivityRecorded('act-1', query),
        (error) => error.code === 'DATABASE_NOT_READY'
    );
});

test('DATABASE_NOT_READY is a 503', () => {
    const error = databaseNotReady('xp_ledger');
    assert.equal(error.status, 503);
    assert.equal(error.code, 'DATABASE_NOT_READY');
});

test('clean database records identity and installs the XP unique index', async () => {
    const memory = migrationMemory();
    const result = await migrate(memory);
    assert.equal(memory.db.tables.has('activity_identity_links'), true);
    assert.equal(memory.db.indexes.has(XP_UNIQUE_INDEX), true);
    assert.ok(result.applied.find((row) => row.id === IDENTITY_MIGRATION_ID));
    assert.ok(result.applied.find((row) => row.id === XP_UNIQUE_MIGRATION_ID));
    assert.equal(result.pending.length, 0);
    assert.ok(memory.db.migrations.find((row) => row.id === XP_UNIQUE_MIGRATION_ID));
});

test('duplicate XP rows leave 003 unrecorded and unresolved', async () => {
    const memory = migrationMemory({ xpDuplicates: 2 });
    const result = await migrate(memory);
    assert.equal(memory.db.tables.has('activity_identity_links'), true);
    assert.equal(memory.db.indexes.has(XP_UNIQUE_INDEX), false);
    assert.equal(
        memory.db.migrations.some((row) => row.id === XP_UNIQUE_MIGRATION_ID),
        false
    );
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0].id, XP_UNIQUE_MIGRATION_ID);
    assert.equal(result.pending[0].reason, 'duplicate_xp_ledger_rows');
    assert.equal(result.pending[0].details.duplicateGroups, 2);
});

test('interrupted migration rolls back and replay can finish', async () => {
    const memory = migrationMemory({ interrupt: 'CREATE TABLE IF NOT EXISTS activity_identity_links' });
    await assert.rejects(() => migrate(memory), (error) => error.code === 'MIGRATION_INTERRUPTED');
    assert.equal(memory.db.tables.has('activity_identity_links'), false);
    assert.equal(memory.db.migrations.length, 0);

    memory.db.interrupt = null;
    const result = await migrate(memory);
    assert.equal(memory.db.tables.has('activity_identity_links'), true);
    assert.ok(result.applied.find((row) => row.id === IDENTITY_MIGRATION_ID));
    assert.ok(memory.db.migrations.find((row) => row.id === XP_UNIQUE_MIGRATION_ID));
});

test('migration replay does not duplicate applied versions', async () => {
    const memory = migrationMemory();
    const first = await migrate(memory);
    const second = await migrate(memory);
    assert.ok(first.applied.length > 0);
    assert.equal(second.applied.length, 0);
    assert.equal(memory.db.migrations.filter((row) => row.id === IDENTITY_MIGRATION_ID).length, 1);
    assert.equal(memory.db.migrations.filter((row) => row.id === XP_UNIQUE_MIGRATION_ID).length, 1);
});

test('recorded 003 with a missing index is not treated as installed when duplicates exist', async () => {
    const memory = migrationMemory({
        xpDuplicates: 4,
        migrations: [{ id: XP_UNIQUE_MIGRATION_ID, notes: 'unique_xp_index_created' }],
    });
    const result = await migrate(memory);
    assert.equal(memory.db.indexes.has(XP_UNIQUE_INDEX), false);
    assert.equal(
        memory.db.migrations.some((row) => row.id === XP_UNIQUE_MIGRATION_ID),
        false
    );
    assert.equal(result.pending[0].reason, 'duplicate_xp_ledger_rows');
});

test('recorded 003 with a missing index is repaired when the ledger is clean', async () => {
    const memory = migrationMemory({
        migrations: [{ id: XP_UNIQUE_MIGRATION_ID, notes: 'unique_xp_index_created' }],
    });
    await migrate(memory);
    assert.equal(memory.db.indexes.has(XP_UNIQUE_INDEX), true);
    const recorded = memory.db.migrations.find((row) => row.id === XP_UNIQUE_MIGRATION_ID);
    assert.ok(recorded);
    assert.equal(
        memory.db.prerequisites.find((row) => row.id === XP_UNIQUE_MIGRATION_ID).status,
        'resolved'
    );
});

test('staging migrate refuses unidentified, missing, and production-equal URLs', () => {
    assert.throws(
        () => resolveMigrateTarget({ POSTGRES_SQL_URL: 'postgres://u:p@prod.example/db' }, []),
        (error) => error.code === 'ENV_UNIDENTIFIED'
    );
    assert.throws(
        () =>
            resolveMigrateTarget(
                { ROXCLUB_ENV: 'staging', POSTGRES_SQL_URL: 'postgres://u:p@prod.example/db' },
                ['--staging']
            ),
        (error) => error.code === 'STAGING_URL_MISSING'
    );
    assert.throws(
        () =>
            resolveMigrateTarget(
                {
                    ROXCLUB_ENV: 'staging',
                    POSTGRES_SQL_URL: 'postgres://u:p@prod.example/neondb',
                    POSTGRES_SQL_URL_STAGING: 'postgres://u:p@prod.example/neondb',
                },
                ['--staging']
            ),
        (error) => error.code === 'STAGING_EQUALS_PRODUCTION'
    );
    const target = resolveMigrateTarget(
        {
            ROXCLUB_ENV: 'staging',
            POSTGRES_SQL_URL: 'postgres://u:p@prod.example/neondb',
            POSTGRES_SQL_URL_STAGING: 'postgres://u:p@staging.example/neondb',
        },
        ['--staging']
    );
    assert.equal(target.environment, 'staging');
    assert.equal(target.host, 'staging.example');
    assert.notEqual(
        connectionFingerprint('postgres://u:p@prod.example/neondb'),
        connectionFingerprint('postgres://u:p@staging.example/neondb')
    );
});

test('staging integration stays disabled without an isolated staging database', () => {
    assert.equal(
        stagingIntegrationAllowed({
            STAGING_INTEGRATION: 'true',
            ROXCLUB_ENV: 'staging',
            POSTGRES_SQL_URL: 'postgres://u:p@prod.example/neondb',
            POSTGRES_SQL_URL_STAGING: 'postgres://u:p@prod.example/neondb',
        }),
        false
    );
    assert.equal(stagingIntegrationAllowed({}), false);
});
