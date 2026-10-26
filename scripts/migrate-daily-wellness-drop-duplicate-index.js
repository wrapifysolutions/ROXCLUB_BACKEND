require('dotenv').config();

const pool = require('../lib/pool');

async function main() {
    await pool.query(`DROP INDEX IF EXISTS daily_wellness_user_local_date_source_uidx`);

    const { rows } = await pool.query(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'daily_wellness'
          AND indexdef ILIKE '%UNIQUE%'
        ORDER BY indexname
        `
    );

    const covering = rows.filter((row) => {
        const definition = row.indexdef.toLowerCase();
        return (
            definition.includes('user_id') &&
            definition.includes('local_date') &&
            definition.includes('source')
        );
    });

    if (covering.length !== 1) {
        throw new Error(
            `expected one unique index on (user_id, local_date, source), found ${covering.length}`
        );
    }

    console.log('daily_wellness has one unique index');
    console.log(`${covering[0].indexname}: ${covering[0].indexdef}`);
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
