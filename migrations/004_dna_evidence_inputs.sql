-- Additive evidence inputs. Do not run on production without explicit approval.
-- Stores VO2max samples and verified/unverified real race evidence.
-- Does not calculate DNA scores, bodyweight-normalized strength, or race calibration effects.
-- Virtual Arena results are rejected by race_calibration_not_virtual_check.

CREATE TABLE IF NOT EXISTS athlete_signal_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signal_key VARCHAR(40) NOT NULL,
    value_numeric NUMERIC,
    unit VARCHAR(40),
    source VARCHAR(40) NOT NULL,
    external_id VARCHAR(120),
    credibility VARCHAR(40) NOT NULL DEFAULT 'UNASSESSED',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT athlete_signal_key_check CHECK (signal_key IN ('vo2max'))
);

CREATE UNIQUE INDEX IF NOT EXISTS athlete_signal_evidence_uidx
    ON athlete_signal_evidence (user_id, signal_key, source, external_id)
    WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS race_calibration_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_name TEXT NOT NULL,
    event_date DATE,
    division VARCHAR(80),
    finish_time_sec INTEGER,
    run_splits JSONB NOT NULL DEFAULT '[]'::jsonb,
    station_splits JSONB NOT NULL DEFAULT '[]'::jsonb,
    roxzone_sec INTEGER,
    verification_status VARCHAR(20) NOT NULL,
    source VARCHAR(40) NOT NULL,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT race_calibration_status_check CHECK (verification_status IN ('unverified', 'verified')),
    CONSTRAINT race_calibration_not_virtual_check CHECK (source <> 'ARENA_VIRTUAL')
);

CREATE UNIQUE INDEX IF NOT EXISTS race_calibration_evidence_uidx
    ON race_calibration_evidence (user_id, source, event_name, event_date);
