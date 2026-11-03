const createArenaEventsTable = `
CREATE TABLE IF NOT EXISTS arena_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(80) NOT NULL UNIQUE,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_key VARCHAR(255),
    location VARCHAR(160) NOT NULL DEFAULT '',
    event_type VARCHAR(40) NOT NULL,
    division VARCHAR(40) NOT NULL DEFAULT 'open',
    category VARCHAR(40) NOT NULL DEFAULT 'hybrid',
    difficulty VARCHAR(40),
    club_id UUID REFERENCES clubs(id) ON DELETE SET NULL,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    review_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    rejection_reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT arena_events_type_check
        CHECK (event_type IN ('simulation', 'in_person', 'hybrid_challenge')),
    CONSTRAINT arena_events_status_check
        CHECK (status IN ('draft', 'upcoming', 'open', 'closed')),
    CONSTRAINT arena_events_division_check
        CHECK (division IN ('open', 'men', 'women', 'mixed')),
    CONSTRAINT arena_events_review_check
        CHECK (review_status IN ('pending', 'approved', 'rejected'))
);
`;

const alterArenaEventReviewColumns = `
ALTER TABLE arena_events
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS sport_type VARCHAR(40),
    ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS timezone VARCHAR(80) DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS max_participants INTEGER;
`;

const createArenaEventVersionsTable = `
CREATE TABLE IF NOT EXISTS arena_event_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES arena_events(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    format_key VARCHAR(80) NOT NULL,
    estimated_duration_ms BIGINT,
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, version_no)
);
`;

const createArenaEventStationsTable = `
CREATE TABLE IF NOT EXISTS arena_event_stations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES arena_event_versions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    segment_type VARCHAR(20) NOT NULL,
    station_key VARCHAR(80) NOT NULL,
    title VARCHAR(120) NOT NULL,
    distance_m INTEGER,
    repetitions INTEGER,
    load_kg NUMERIC,
    instructions TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (version_id, sequence),
    CONSTRAINT arena_event_stations_type_check
        CHECK (segment_type IN ('run', 'station', 'roxzone'))
);
`;

const createArenaParticipantsTable = `
CREATE TABLE IF NOT EXISTS arena_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES arena_events(id) ON DELETE CASCADE,
    event_version_id UUID NOT NULL REFERENCES arena_event_versions(id),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'joined',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (event_id, user_id),
    CONSTRAINT arena_participants_status_check
        CHECK (status IN ('joined', 'started', 'completed', 'withdrawn'))
);
`;

const createArenaRaceStrategiesTable = `
CREATE TABLE IF NOT EXISTS arena_race_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL UNIQUE REFERENCES arena_participants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES arena_events(id) ON DELETE CASCADE,
    event_version_id UUID NOT NULL REFERENCES arena_event_versions(id),
    strategy_version INTEGER NOT NULL DEFAULT 1,
    goal_time_ms BIGINT,
    run_pace_ms_per_km INTEGER,
    pacing_strategy VARCHAR(20) NOT NULL DEFAULT 'target',
    station_targets JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT arena_race_strategies_pacing_check
        CHECK (pacing_strategy IN ('conservative', 'target', 'aggressive'))
);
`;

const createArenaRaceSessionsTable = `
CREATE TABLE IF NOT EXISTS arena_race_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES arena_participants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES arena_events(id) ON DELETE CASCADE,
    event_version_id UUID NOT NULL REFERENCES arena_event_versions(id),
    status VARCHAR(20) NOT NULL DEFAULT 'prepared',
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    abandoned_at TIMESTAMPTZ,
    current_sequence INTEGER NOT NULL DEFAULT 1,
    engine_available BOOLEAN NOT NULL DEFAULT FALSE,
    dna_snapshot JSONB,
    evidence_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT arena_race_sessions_status_check
        CHECK (status IN ('prepared', 'active', 'completed', 'abandoned', 'held'))
);
`;

const createArenaRaceSegmentsTable = `
CREATE TABLE IF NOT EXISTS arena_race_segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES arena_race_sessions(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    station_key VARCHAR(80) NOT NULL,
    segment_type VARCHAR(20) NOT NULL,
    title VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    elapsed_ms INTEGER,
    athlete_decision VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (session_id, sequence),
    CONSTRAINT arena_race_segments_status_check
        CHECK (status IN ('pending', 'active', 'completed', 'skipped')),
    CONSTRAINT arena_race_segments_decision_check
        CHECK (athlete_decision IS NULL OR athlete_decision IN ('hold', 'push', 'back_off'))
);
`;

const createArenaRaceResultsTable = `
CREATE TABLE IF NOT EXISTS arena_race_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE REFERENCES arena_race_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES arena_events(id) ON DELETE CASCADE,
    event_version_id UUID NOT NULL REFERENCES arena_event_versions(id),
    total_elapsed_ms BIGINT,
    result_status VARCHAR(20) NOT NULL,
    evidence_source VARCHAR(40) NOT NULL,
    evidence_confidence VARCHAR(20) NOT NULL DEFAULT 'LOW',
    competitive_eligible BOOLEAN NOT NULL DEFAULT FALSE,
    division VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT arena_race_results_status_check
        CHECK (result_status IN ('unverified', 'standard', 'verified', 'held', 'abandoned', 'invalid'))
);
`;

const createArenaResultAuditsTable = `
CREATE TABLE IF NOT EXISTS arena_result_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    result_id UUID NOT NULL REFERENCES arena_race_results(id) ON DELETE CASCADE,
    actor_user_id UUID REFERENCES users(id),
    action VARCHAR(60) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createArenaIndexes = `
CREATE INDEX IF NOT EXISTS arena_events_status_starts_idx
    ON arena_events (status, starts_at);
CREATE INDEX IF NOT EXISTS arena_participants_user_idx
    ON arena_participants (user_id, joined_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS arena_sessions_one_open_idx
    ON arena_race_sessions (user_id, event_id)
    WHERE status IN ('prepared', 'active', 'held');
CREATE INDEX IF NOT EXISTS arena_results_event_rank_idx
    ON arena_race_results (event_id, competitive_eligible, result_status, total_elapsed_ms);
CREATE INDEX IF NOT EXISTS arena_results_user_idx
    ON arena_race_results (user_id, created_at DESC);
`;

const arenaStatements = [
    createArenaEventsTable,
    alterArenaEventReviewColumns,
    createArenaEventVersionsTable,
    createArenaEventStationsTable,
    createArenaParticipantsTable,
    createArenaRaceStrategiesTable,
    createArenaRaceSessionsTable,
    createArenaRaceSegmentsTable,
    createArenaRaceResultsTable,
    createArenaResultAuditsTable,
    createArenaIndexes,
];

module.exports = { arenaStatements };
