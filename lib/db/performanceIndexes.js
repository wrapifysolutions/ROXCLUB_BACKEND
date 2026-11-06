const pool = require('../pool');

// Additive indexes only. Query results and write paths stay the same.
const INDEXES = [
    `CREATE INDEX IF NOT EXISTS xp_ledger_user_created_idx
        ON xp_ledger (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS saved_workouts_user_created_idx
        ON saved_workouts (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS notifications_user_created_idx
        ON notifications (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS coins_ledger_user_created_idx
        ON coins_ledger (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS user_rewards_user_created_idx
        ON user_rewards (user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS activity_splits_activity_idx
        ON activity_splits (activity_id)`,
    `CREATE INDEX IF NOT EXISTS activity_debriefs_user_idx
        ON activity_debriefs (user_id)`,
    `CREATE INDEX IF NOT EXISTS oauth_states_user_idx
        ON oauth_states (user_id)`,
    `CREATE INDEX IF NOT EXISTS program_assignments_athlete_idx
        ON program_assignments (athlete_user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS program_assignments_club_idx
        ON program_assignments (club_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS coach_programs_club_status_idx
        ON coach_programs (club_id, status)`,
    `CREATE INDEX IF NOT EXISTS daily_wellness_user_date_idx
        ON daily_wellness (user_id, local_date DESC)`,
    `CREATE INDEX IF NOT EXISTS activities_user_source_start_idx
        ON activities (user_id, source, start_at DESC)`,
    `CREATE INDEX IF NOT EXISTS club_broadcasts_club_idx
        ON club_broadcasts (club_id, created_at DESC)`,
];

async function ensurePerformanceIndexes() {
    const created = [];
    const skipped = [];
    for (const sql of INDEXES) {
        try {
            await pool.query(sql);
            const name = sql.match(/EXISTS\s+(\S+)/i)?.[1];
            if (name) created.push(name);
        } catch (error) {
            skipped.push({ sql: sql.slice(0, 80), code: error.code, message: error.message });
            if (error.code !== '42P01' && error.code !== '42703') {
                console.warn('index: skip', error.code || error.message);
            }
        }
    }
    const result = { created: created.length, skipped: skipped.length };
    console.log('Performance indexes', result);
    return result;
}

module.exports = { INDEXES, ensurePerformanceIndexes };
