const pool = require('../lib/pool');
const { createUsersTable } = require('../models/Onboarding/UserOnboardingData');

async function main() {
    await pool.query(createUsersTable);

    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_hash TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_email_verified BOOLEAN DEFAULT FALSE');

    const cols = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'users'
        ORDER BY ordinal_position
    `);

    console.log(cols.rows.map((row) => row.column_name).join(', '));
    await pool.end();
}

main().catch(async (error) => {
    console.error(error.message);
    try {
        await pool.end();
    } catch (_) {}
    process.exit(1);
});
