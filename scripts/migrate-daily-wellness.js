require('dotenv').config();

const pool = require('../lib/pool');
const { createDailyWellnessTable } = require('../models/Readiness/ReadinessSchema');

async function main() {
    await pool.query(createDailyWellnessTable);

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

    if (covering.length === 0) {
        throw new Error('daily_wellness is missing a unique index on (user_id, local_date, source)');
    }

    console.log('daily_wellness unique index ready');
    for (const row of covering) {
        console.log(`${row.indexname}: ${row.indexdef}`);
    }
}

main()
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(async () => {
        await pool.end().catch(() => {});
    });
