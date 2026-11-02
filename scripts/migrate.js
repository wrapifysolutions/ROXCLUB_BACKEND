require('dotenv').config();

const { resolveMigrateTarget, describeConnection } = require('../lib/migrations/env');
const { isProductionRuntime, assertMigrateSafety } = require('../lib/migrations/policy');

async function main() {
    const target = resolveMigrateTarget(process.env, process.argv.slice(2));
    process.env.ROXCLUB_ENV = target.environment;
    process.env.POSTGRES_SQL_URL = target.connectionString;

    if (target.environment === 'production' || isProductionRuntime()) {
        if (String(process.env.ALLOW_PRODUCTION_MIGRATIONS || '').toLowerCase() !== 'true') {
            console.error('Refusing to migrate: production/Vercel runtime without ALLOW_PRODUCTION_MIGRATIONS=true');
            process.exit(2);
        }
    }

    assertMigrateSafety();

    const { host, database } = describeConnection(target.connectionString);
    console.log(
        JSON.stringify({
            migrating: true,
            environment: target.environment,
            host,
            database,
        })
    );

    const { runVersionedMigrations } = require('../lib/migrations/run');
    const { baselineStatements } = require('../lib/onboarding/schema');
    const result = await runVersionedMigrations({ baselineStatements, force: true });
    console.log(
        JSON.stringify(
            {
                applied: result.applied,
                skipped: result.skipped,
                pending: result.pending,
            },
            null,
            2
        )
    );
    if (result.pending && result.pending.length) {
        console.warn('Unresolved migration prerequisites remain; schema_migrations did not record them as applied.');
        process.exit(3);
    }
}

main().catch((error) => {
    console.error(error.code || 'MIGRATE_FAILED', error.message);
    process.exit(1);
});
