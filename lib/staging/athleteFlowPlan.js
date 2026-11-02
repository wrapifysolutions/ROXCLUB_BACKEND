const ATHLETE_FLOW_STEPS = [
    { id: 'signup', api: 'POST /auth/email-signup', sql: 'users' },
    { id: 'onboarding', api: 'POST /onboarding/complete', sql: 'athlete_profiles, athlete_dna, scheduled_sessions' },
    { id: 'workout', api: 'POST /api/workouts/sessions/:id/complete', sql: 'workout_sessions, activities' },
    { id: 'canonical_activity', api: 'canonical upsert by (user_id, source, external_id)', sql: 'activities' },
    { id: 'xp', api: 'complete session xp_ledger insert', sql: 'xp_ledger' },
    { id: 'dna_evidence', api: 'queueActivityRecorded', sql: 'activity_evidence' },
    { id: 'station_proficiency', api: 'queueActivityRecorded', sql: 'station_evidence, station_proficiency' },
    { id: 'readiness', api: 'enqueueReadinessRecompute', sql: 'daily_readiness' },
    { id: 'arena_snapshot', api: 'GET /api/arena/engine-inputs', sql: 'athlete_dna, station_proficiency, activity_identity_links' },
    { id: 'race_history', api: 'GET /api/arena/history', sql: 'arena_race_results' },
];

const STAGING_SQL_CHECKS = {
    signup: `SELECT id, email, onboarding_completed FROM users WHERE email = $1`,
    onboarding: `SELECT user_id, status, speed, mobility FROM athlete_dna WHERE user_id = $1`,
    workout: `SELECT id, status, activity_id FROM workout_sessions WHERE user_id = $1 ORDER BY started_at DESC LIMIT 1`,
    canonical_activity: `SELECT id, source, external_id, provenance FROM activities WHERE user_id = $1`,
    xp: `SELECT activity_id, reason, COUNT(*)::int AS rows FROM xp_ledger WHERE user_id = $1 GROUP BY activity_id, reason`,
    dna_evidence: `SELECT activity_id, COUNT(*)::int AS rows FROM activity_evidence WHERE activity_id = ANY($1::uuid[]) GROUP BY activity_id`,
    station_proficiency: `SELECT user_id, station_key, evidence_count, score, score_status FROM station_proficiency WHERE user_id = $1`,
    readiness: `SELECT user_id, local_date, status FROM daily_readiness WHERE user_id = $1 ORDER BY local_date DESC LIMIT 1`,
    arena_snapshot: `SELECT id, source FROM activities WHERE user_id = $1`,
    race_history: `SELECT id, verification_status FROM arena_race_results WHERE user_id = $1`,
    identity_links: `SELECT activity_a, activity_b, status, user_id FROM activity_identity_links WHERE user_id = $1`,
    xp_unique_index: `SELECT indexname FROM pg_indexes WHERE indexname = 'xp_ledger_activity_reason_uidx'`,
    schema_migrations: `SELECT id, notes FROM schema_migrations ORDER BY id`,
    prerequisites: `SELECT id, status, reason FROM schema_migration_prerequisites ORDER BY id`,
};

function assertVirtualRaceDisabled(engine) {
    return engine?.available === false;
}

module.exports = { ATHLETE_FLOW_STEPS, STAGING_SQL_CHECKS, assertVirtualRaceDisabled };
