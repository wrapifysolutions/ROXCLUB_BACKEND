const fs = require('fs');
const path = require('path');
const { schemaMutationsAllowed, assertMigrateSafety } = require('./policy');
const { createXpLedgerActivityReasonIndex } = require('../../models/Athlete/AthleteEngineSchema');

const IDENTITY_MIGRATION_ID = '002_activity_identity';
const XP_UNIQUE_MIGRATION_ID = '003_xp_ledger_activity_reason_unique';
const XP_UNIQUE_INDEX = 'xp_ledger_activity_reason_uidx';

const MIGRATIONS = [
    { id: '000_baseline', kind: 'statements' },
    {
        id: '001_athlete_dna_speed_and_proficiency',
        kind: 'file',
        file: '001_athlete_dna_speed_and_proficiency.sql',
        legacyFile: '2026-11-02-athlete-dna-speed-and-proficiency.sql',
    },
    { id: IDENTITY_MIGRATION_ID, kind: 'identity' },
    { id: XP_UNIQUE_MIGRATION_ID, kind: 'xp_unique' },
    {
        id: '004_dna_evidence_inputs',
        kind: 'file',
        file: '004_dna_evidence_inputs.sql',
    },
];

function dbTools(options) {
    return {
        withTransaction:
            options.withTransaction ||
            ((work, timeoutMs) => require('../dbQuery').withTransaction(work, timeoutMs)),
        runStatementsOnClient:
            options.runStatementsOnClient ||
            ((client, statements) => require('../dbQuery').runStatementsOnClient(client, statements)),
    };
}

function readMigrationSql(entry) {
    const dir = path.join(__dirname, '../../migrations');
    const primary = path.join(dir, entry.file);
    if (fs.existsSync(primary)) return fs.readFileSync(primary, 'utf8');
    if (entry.legacyFile) {
        const legacy = path.join(dir, entry.legacyFile);
        if (fs.existsSync(legacy)) return fs.readFileSync(legacy, 'utf8');
    }
    return '';
}

async function countDuplicateXp(query) {
    const { rows } = await query(
        `
        /* migrate:xp_duplicates */
        SELECT COUNT(*)::int AS count
        FROM (
            SELECT activity_id, reason
            FROM xp_ledger
            WHERE activity_id IS NOT NULL
            GROUP BY activity_id, reason
            HAVING COUNT(*) > 1
        ) duplicates
        `
    );
    return Number(rows[0]?.count) || 0;
}

async function xpUniqueIndexExists(query) {
    const { rows } = await query(
        `
        /* migrate:xp_index_exists */
        SELECT 1
        FROM pg_indexes
        WHERE indexname = $1
        LIMIT 1
        `,
        [XP_UNIQUE_INDEX]
    );
    return rows.length > 0;
}

async function appliedIds(query) {
    try {
        const { rows } = await query(`SELECT id FROM schema_migrations`);
        return new Set(rows.map((row) => row.id));
    } catch (error) {
        if (error.code === '42P01') return new Set();
        throw error;
    }
}

async function recordMigration(query, id, notes) {
    await query(
        `
        INSERT INTO schema_migrations (id, notes)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET notes = EXCLUDED.notes
        `,
        [id, notes || null]
    );
}

async function unrecordMigration(query, id) {
    await query(`DELETE FROM schema_migrations WHERE id = $1`, [id]);
}

async function upsertPrerequisite(query, id, status, reason, details) {
    await query(
        `
        /* migrate:upsert_prerequisite */
        INSERT INTO schema_migration_prerequisites (id, status, reason, details)
        VALUES ($1, $2, $3, $4::jsonb)
        ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            reason = EXCLUDED.reason,
            details = EXCLUDED.details,
            updated_at = NOW()
        `,
        [id, status, reason, JSON.stringify(details || {})]
    );
}

async function listUnresolvedPrerequisites(query) {
    const { rows } = await query(
        `
        SELECT id, status, reason, details
        FROM schema_migration_prerequisites
        WHERE status = 'unresolved'
        ORDER BY id
        `
    );
    return rows.map((row) => ({
        id: row.id,
        status: row.status,
        reason: row.reason,
        details: row.details || {},
    }));
}

async function applyIdentityMigration(query) {
    await query(`
        CREATE TABLE IF NOT EXISTS activity_identity_links (
            activity_a UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            activity_b UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
            match_basis VARCHAR(80) NOT NULL DEFAULT 'existing_same_workout_helper',
            provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (activity_a, activity_b),
            CONSTRAINT activity_identity_order_check CHECK (activity_a::text < activity_b::text),
            CONSTRAINT activity_identity_status_check
                CHECK (status IN ('candidate', 'associated', 'unresolved', 'rejected'))
        )
    `);
    await query(`
        CREATE INDEX IF NOT EXISTS activity_identity_links_user_idx
            ON activity_identity_links (user_id, status)
    `);
    return 'identity_links_created';
}

async function applyXpUniqueMigration(query) {
    let duplicates = 0;
    try {
        duplicates = await countDuplicateXp(query);
    } catch (error) {
        if (error.code !== '42P01') throw error;
        await unrecordMigration(query, XP_UNIQUE_MIGRATION_ID);
        await upsertPrerequisite(query, XP_UNIQUE_MIGRATION_ID, 'unresolved', 'xp_ledger_missing', {
            index: XP_UNIQUE_INDEX,
        });
        return { recorded: false, notes: 'xp_ledger_missing' };
    }

    const exists = await xpUniqueIndexExists(query);
    if (exists) {
        await recordMigration(query, XP_UNIQUE_MIGRATION_ID, 'unique_xp_index_present');
        await upsertPrerequisite(query, XP_UNIQUE_MIGRATION_ID, 'resolved', 'unique_xp_index_present', {
            index: XP_UNIQUE_INDEX,
        });
        return { recorded: true, notes: 'unique_xp_index_present' };
    }

    if (duplicates > 0) {
        await unrecordMigration(query, XP_UNIQUE_MIGRATION_ID);
        await upsertPrerequisite(query, XP_UNIQUE_MIGRATION_ID, 'unresolved', 'duplicate_xp_ledger_rows', {
            index: XP_UNIQUE_INDEX,
            duplicateGroups: duplicates,
        });
        console.warn(
            'xp_ledger unique index is an unresolved prerequisite; historical duplicates were not rewritten',
            duplicates
        );
        return { recorded: false, notes: `duplicate_xp_ledger_rows=${duplicates}` };
    }

    await query(createXpLedgerActivityReasonIndex);
    const installed = await xpUniqueIndexExists(query);
    if (!installed) {
        await unrecordMigration(query, XP_UNIQUE_MIGRATION_ID);
        await upsertPrerequisite(query, XP_UNIQUE_MIGRATION_ID, 'unresolved', 'unique_xp_index_missing_after_create', {
            index: XP_UNIQUE_INDEX,
        });
        const error = new Error('XP unique index was not present after CREATE INDEX');
        error.code = 'XP_UNIQUE_INDEX_MISSING';
        throw error;
    }
    await recordMigration(query, XP_UNIQUE_MIGRATION_ID, 'unique_xp_index_created');
    await upsertPrerequisite(query, XP_UNIQUE_MIGRATION_ID, 'resolved', 'unique_xp_index_created', {
        index: XP_UNIQUE_INDEX,
    });
    return { recorded: true, notes: 'unique_xp_index_created' };
}

async function runVersionedMigrations(options = {}) {
    if (!schemaMutationsAllowed() && !options.force) {
        return { applied: [], skipped: true, reason: 'MIGRATIONS_DISABLED', pending: [] };
    }
    if (!options.force) assertMigrateSafety();

    const { withTransaction, runStatementsOnClient } = dbTools(options);
    return withTransaction(async (client) => {
        const query = (sql, params) => client.query(sql, params);
        await query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                id VARCHAR(120) PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                notes TEXT
            )
        `);
        await query(`ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS notes TEXT`);
        await query(`
            CREATE TABLE IF NOT EXISTS schema_migration_prerequisites (
                id VARCHAR(120) PRIMARY KEY,
                status VARCHAR(20) NOT NULL,
                reason TEXT,
                details JSONB NOT NULL DEFAULT '{}'::jsonb,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT schema_migration_prerequisites_status_check
                    CHECK (status IN ('unresolved', 'resolved'))
            )
        `);
        const done = await appliedIds(query);
        const applied = [];
        for (const entry of MIGRATIONS) {
            if (entry.kind === 'xp_unique') {
                const result = await applyXpUniqueMigration(query);
                if (result.recorded && !done.has(entry.id)) {
                    applied.push({ id: entry.id, notes: result.notes });
                }
                continue;
            }
            if (done.has(entry.id)) continue;
            let notes = null;
            if (entry.kind === 'statements') {
                const baseline = options.baselineStatements || [];
                if (baseline.length) await runStatementsOnClient(client, baseline);
                notes = 'baseline_if_not_exists';
            } else if (entry.kind === 'file') {
                const sql = readMigrationSql(entry);
                if (sql.trim()) await runStatementsOnClient(client, [sql]);
                notes = entry.file;
            } else if (entry.kind === 'identity') {
                notes = await applyIdentityMigration(query);
            }
            await recordMigration(query, entry.id, notes);
            applied.push({ id: entry.id, notes });
        }
        const pending = await listUnresolvedPrerequisites(query);
        return { applied, skipped: false, pending };
    }, 60000);
}

module.exports = {
    runVersionedMigrations,
    MIGRATIONS,
    IDENTITY_MIGRATION_ID,
    XP_UNIQUE_MIGRATION_ID,
    XP_UNIQUE_INDEX,
    countDuplicateXp,
    xpUniqueIndexExists,
};
