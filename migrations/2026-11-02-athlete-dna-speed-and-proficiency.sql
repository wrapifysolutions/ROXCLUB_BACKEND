-- Additive only. Do not run on production without explicit approval.
-- Applied automatically on API start via ensureOnboardingProfileSchema.

ALTER TABLE athlete_dna
    ADD COLUMN IF NOT EXISTS speed NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_endurance NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_engine NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_strength NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_power NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_speed NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_mobility NUMERIC;

CREATE TABLE IF NOT EXISTS athlete_dna_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_version VARCHAR(20) NOT NULL DEFAULT 'v0',
    status VARCHAR(30) NOT NULL DEFAULT 'CALIBRATING',
    endurance NUMERIC,
    engine NUMERIC,
    strength NUMERIC,
    power NUMERIC,
    speed NUMERIC,
    mobility NUMERIC,
    source VARCHAR(40) NOT NULL DEFAULT 'system',
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS athlete_dna_snapshots_user_idx
    ON athlete_dna_snapshots (user_id, captured_at DESC);

ALTER TABLE station_proficiency
    ADD COLUMN IF NOT EXISTS current_tier VARCHAR(40),
    ADD COLUMN IF NOT EXISTS peak_tier VARCHAR(40),
    ADD COLUMN IF NOT EXISTS tier_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_MODEL',
    ADD COLUMN IF NOT EXISTS last_source VARCHAR(40),
    ADD COLUMN IF NOT EXISTS last_duration_sec INTEGER,
    ADD COLUMN IF NOT EXISTS last_reps INTEGER,
    ADD COLUMN IF NOT EXISTS last_load_kg NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS last_distance_m NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS last_provenance JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE station_evidence
    ADD COLUMN IF NOT EXISTS distance_m NUMERIC(12,2);

CREATE TABLE IF NOT EXISTS station_proficiency_evidence (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_key VARCHAR(80) NOT NULL,
    activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_index INTEGER NOT NULL,
    source VARCHAR(40),
    evidence_status VARCHAR(20),
    duration_sec INTEGER,
    reps INTEGER,
    load_kg NUMERIC(8,2),
    distance_m NUMERIC(12,2),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, station_key, activity_id, activity_index)
);

CREATE TABLE IF NOT EXISTS station_proficiency_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_key VARCHAR(80) NOT NULL,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(30) NOT NULL DEFAULT 'CALIBRATING',
    current_tier VARCHAR(40),
    peak_tier VARCHAR(40),
    model_version VARCHAR(20) NOT NULL DEFAULT 'pending_v0',
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS station_proficiency_history_user_idx
    ON station_proficiency_history (user_id, station_key, recorded_at DESC);
