const createAppleHealthSamplesTableOnly = `
CREATE TABLE IF NOT EXISTS apple_health_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    sample_type VARCHAR(40) NOT NULL
        CHECK (
            sample_type IN (
                'hrv',
                'sleep',
                'resting_hr',
                'steps',
                'workout'
            )
        ),

    value NUMERIC(12,4),
    unit VARCHAR(30),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,

    source_name VARCHAR(120),
    external_id VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_apple_health_external
        UNIQUE (user_id, sample_type, external_id)
);
`;

const createAppleHealthSamplesIndex = `
CREATE INDEX IF NOT EXISTS idx_apple_health_samples_user_type_start
    ON apple_health_samples (user_id, sample_type, start_at DESC);
`;

module.exports = {
    createAppleHealthSamplesTableOnly,
    createAppleHealthSamplesIndex,
};
