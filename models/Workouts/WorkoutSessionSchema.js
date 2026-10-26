const createWorkoutSessionsTable = `
CREATE TABLE IF NOT EXISTS workout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workout_id VARCHAR(60) NOT NULL,
    scheduled_session_id UUID REFERENCES scheduled_sessions(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'partial', 'cancelled')),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    total_duration_sec INTEGER,
    paused_duration_sec INTEGER NOT NULL DEFAULT 0,
    idempotency_key VARCHAR(120) NOT NULL,
    activity_id UUID,
    local_date DATE,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createWorkoutSessionIdempotencyIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_user_idempotency_uidx
    ON workout_sessions (user_id, idempotency_key);
`;

const createWorkoutSessionStatusIndex = `
CREATE INDEX IF NOT EXISTS workout_sessions_user_status_idx
    ON workout_sessions (user_id, status);
`;

const createWorkoutSessionProgressTable = `
CREATE TABLE IF NOT EXISTS workout_session_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
    activity_index INTEGER NOT NULL,
    kind VARCHAR(40) NOT NULL
        CHECK (kind IN ('run', 'station', 'roxzone', 'strength_exercise', 'recovery_block')),
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    UNIQUE (session_id, activity_index)
);
`;

const createActivitiesTable = `
CREATE TABLE IF NOT EXISTS activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(40) NOT NULL,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
    workout_id VARCHAR(60),
    activity_type VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    duration_sec INTEGER,
    distance_m NUMERIC(12,2),
    avg_hr NUMERIC(6,2),
    max_hr NUMERIC(6,2),
    evidence_status VARCHAR(20),
    roxzone_total_sec INTEGER NOT NULL DEFAULT 0,
    session_id UUID UNIQUE REFERENCES workout_sessions(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createActivitiesIndex = `
CREATE INDEX IF NOT EXISTS activities_user_start_idx
    ON activities (user_id, start_at DESC);
`;

const createActivitySplitsTable = `
CREATE TABLE IF NOT EXISTS activity_splits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_index INTEGER NOT NULL,
    kind VARCHAR(40) NOT NULL,
    name VARCHAR(160) NOT NULL,
    duration_sec INTEGER,
    distance_m NUMERIC(12,2),
    reps INTEGER,
    load_kg NUMERIC(8,2),
    pace_sec_per_km NUMERIC(10,2),
    split_sec_per_500m NUMERIC(10,2),
    rep_rate NUMERIC(8,2),
    avg_hr NUMERIC(6,2),
    input_method VARCHAR(20),
    data JSONB NOT NULL DEFAULT '{}'::jsonb
);
`;

const createActivityGpsPointsTable = `
CREATE TABLE IF NOT EXISTS activity_gps_points (
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    ts TIMESTAMPTZ,
    altitude DOUBLE PRECISION,
    PRIMARY KEY (activity_id, seq)
);
`;

const createActivityDebriefsTable = `
CREATE TABLE IF NOT EXISTS activity_debriefs (
    activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rpe SMALLINT NOT NULL CHECK (rpe BETWEEN 1 AND 10),
    flags TEXT[] NOT NULL DEFAULT '{}',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createCoinsLedgerTable = `
CREATE TABLE IF NOT EXISTS coins_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    coins INTEGER NOT NULL,
    reason VARCHAR(80),
    activity_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createUserStreaksTable = `
CREATE TABLE IF NOT EXISTS user_streaks (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    last_active_on DATE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createUserRewardsTable = `
CREATE TABLE IF NOT EXISTS user_rewards (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_id UUID,
    kind VARCHAR(20) NOT NULL,
    code VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, kind, code)
);
`;

const createActivityEvidenceTable = `
CREATE TABLE IF NOT EXISTS activity_evidence (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_index INTEGER NOT NULL,
    kind VARCHAR(40) NOT NULL,
    name VARCHAR(160),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, activity_index)
);
`;

const createStationEvidenceTable = `
CREATE TABLE IF NOT EXISTS station_evidence (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_index INTEGER NOT NULL,
    name VARCHAR(160) NOT NULL,
    duration_sec INTEGER,
    reps INTEGER,
    load_kg NUMERIC(8,2),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (activity_id, activity_index)
);
`;

const alterXpLedgerColumns = `
ALTER TABLE xp_ledger
    ADD COLUMN IF NOT EXISTS activity_id UUID,
    ADD COLUMN IF NOT EXISTS calc_version VARCHAR(20);
`;

const alterScheduledSessionStatus = `
ALTER TABLE scheduled_sessions
    ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'pending';
`;

const workoutSessionStatements = [
    createWorkoutSessionsTable,
    createWorkoutSessionIdempotencyIndex,
    createWorkoutSessionStatusIndex,
    createWorkoutSessionProgressTable,
    createActivitiesTable,
    createActivitiesIndex,
    createActivitySplitsTable,
    createActivityGpsPointsTable,
    createActivityDebriefsTable,
    createCoinsLedgerTable,
    createUserStreaksTable,
    createUserRewardsTable,
    createActivityEvidenceTable,
    createStationEvidenceTable,
    alterXpLedgerColumns,
    alterScheduledSessionStatus,
];

module.exports = {
    workoutSessionStatements,
    createWorkoutSessionsTable,
    createActivitiesTable,
    createActivityDebriefsTable,
    alterXpLedgerColumns,
    alterScheduledSessionStatus,
};
