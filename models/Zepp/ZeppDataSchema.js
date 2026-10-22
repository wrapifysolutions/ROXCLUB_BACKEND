const createZeppHealthSamplesTable = `
CREATE TABLE IF NOT EXISTS zepp_health_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID
        REFERENCES users(id) ON DELETE CASCADE,
    provider_user_id VARCHAR(255),
    sample_type VARCHAR(40) NOT NULL
        CHECK (sample_type IN ('activity', 'hrv', 'sleep')),
    external_id VARCHAR(255),
    name VARCHAR(255),
    sport_type VARCHAR(80),
    value NUMERIC(14,4),
    unit VARCHAR(40),
    start_at TIMESTAMPTZ,
    end_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    distance NUMERIC(14,4),
    calories NUMERIC(10,2),
    average_heartrate NUMERIC(8,2),
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_zepp_sample UNIQUE (sample_type, external_id)
);
`;

const createZeppHealthSamplesIndex = `
CREATE INDEX IF NOT EXISTS idx_zepp_health_samples_user_start
    ON zepp_health_samples (user_id, sample_type, start_at DESC);
`;

module.exports = {
    createZeppHealthSamplesTable,
    createZeppHealthSamplesIndex,
};
