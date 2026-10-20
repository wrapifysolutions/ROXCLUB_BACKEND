const pool = require('../lib/pool');
const { ensureStravaTables } = require('../lib/strava/stravaTokens');

async function main() {
    await ensureStravaTables();
    console.log('Strava tables ready');
    await pool.end();
}

main().catch(async (error) => {
    console.error(error);
    try {
        await pool.end();
    } catch (_) {}
    process.exit(1);
});
