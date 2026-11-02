const createStationProficiencyTable = `
CREATE TABLE IF NOT EXISTS station_proficiency (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    station_key VARCHAR(80) NOT NULL,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    last_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
    last_evidence_status VARCHAR(20),
    status VARCHAR(30) NOT NULL DEFAULT 'CALIBRATING',
    score NUMERIC,
    score_status VARCHAR(30) NOT NULL DEFAULT 'PENDING_MODEL',
    model_version VARCHAR(20) NOT NULL DEFAULT 'pending_v0',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, station_key)
);
`;

const alterAthleteDnaSpeedAndPeaks = `
ALTER TABLE athlete_dna
    ADD COLUMN IF NOT EXISTS speed NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_endurance NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_engine NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_strength NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_power NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_speed NUMERIC,
    ADD COLUMN IF NOT EXISTS peak_mobility NUMERIC;
`;

const createAthleteDnaSnapshotsTable = `
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
`;

const createAthleteDnaSnapshotsIndex = `
CREATE INDEX IF NOT EXISTS athlete_dna_snapshots_user_idx
    ON athlete_dna_snapshots (user_id, captured_at DESC);
`;

const alterStationProficiencyFoundation = `
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
`;

const alterStationEvidenceDistance = `
ALTER TABLE station_evidence
    ADD COLUMN IF NOT EXISTS distance_m NUMERIC(12,2);
`;

const createStationProficiencyEvidenceTable = `
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
`;

const createStationProficiencyHistoryTable = `
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
`;

const createStationProficiencyHistoryIndex = `
CREATE INDEX IF NOT EXISTS station_proficiency_history_user_idx
    ON station_proficiency_history (user_id, station_key, recorded_at DESC);
`;

const alterActivitiesExternalId = `
ALTER TABLE activities
    ADD COLUMN IF NOT EXISTS external_id VARCHAR(80);
`;

const createActivitiesExternalIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS activities_user_source_external_uidx
    ON activities (user_id, source, external_id)
    WHERE external_id IS NOT NULL;
`;

const alterArenaSessionEvidenceSnapshot = `
ALTER TABLE arena_race_sessions
    ADD COLUMN IF NOT EXISTS evidence_snapshot JSONB;
`;

const createActivityIdentityLinksTable = `
CREATE TABLE IF NOT EXISTS activity_identity_links (
    activity_a UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_b UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
    match_basis VARCHAR(80) NOT NULL DEFAULT 'existing_same_workout_helper',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_a, activity_b),
    CONSTRAINT activity_identity_order_check CHECK (activity_a::text < activity_b::text),
    CONSTRAINT activity_identity_status_check
        CHECK (status IN ('candidate', 'associated', 'unresolved', 'rejected'))
);
`;

const createActivityIdentityUserIndex = `
CREATE INDEX IF NOT EXISTS activity_identity_links_user_idx
    ON activity_identity_links (user_id, status);
`;

const createXpLedgerActivityReasonIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS xp_ledger_activity_reason_uidx
    ON xp_ledger (activity_id, reason)
    WHERE activity_id IS NOT NULL;
`;

const createAthleteSignalEvidenceTable = `
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
`;

const createAthleteSignalEvidenceIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS athlete_signal_evidence_uidx
    ON athlete_signal_evidence (user_id, signal_key, source, external_id)
    WHERE external_id IS NOT NULL;
`;

const createRaceCalibrationEvidenceTable = `
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
`;

const createRaceCalibrationEvidenceIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS race_calibration_evidence_uidx
    ON race_calibration_evidence (user_id, source, event_name, event_date);
`;

const createSchemaMigrationsTable = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    id VARCHAR(120) PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const athleteEngineStatements = [
    createStationProficiencyTable,
    alterAthleteDnaSpeedAndPeaks,
    createAthleteDnaSnapshotsTable,
    createAthleteDnaSnapshotsIndex,
    alterStationProficiencyFoundation,
    alterStationEvidenceDistance,
    createStationProficiencyEvidenceTable,
    createStationProficiencyHistoryTable,
    createStationProficiencyHistoryIndex,
    alterActivitiesExternalId,
    createActivitiesExternalIndex,
    alterArenaSessionEvidenceSnapshot,
    createActivityIdentityLinksTable,
    createActivityIdentityUserIndex,
    createAthleteSignalEvidenceTable,
    createAthleteSignalEvidenceIndex,
    createRaceCalibrationEvidenceTable,
    createRaceCalibrationEvidenceIndex,
    createSchemaMigrationsTable,
];

module.exports = {
    athleteEngineStatements,
    createXpLedgerActivityReasonIndex,
    createSchemaMigrationsTable,
    createAthleteSignalEvidenceTable,
    createAthleteSignalEvidenceIndex,
    createRaceCalibrationEvidenceTable,
    createRaceCalibrationEvidenceIndex,
};
