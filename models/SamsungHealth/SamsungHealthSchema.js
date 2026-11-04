const createSamsungHealthSamplesTable = `
CREATE TABLE IF NOT EXISTS samsung_health_samples (
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

    CONSTRAINT unique_samsung_health_external
        UNIQUE (user_id, sample_type, external_id)
);
`;

const createSamsungHealthSamplesIndex = `
CREATE INDEX IF NOT EXISTS idx_samsung_health_samples_user_type_start
    ON samsung_health_samples (user_id, sample_type, start_at DESC);
`;

const allowSamsungHealthProvider = `
DO $$
BEGIN
    ALTER TABLE user_integrations DROP CONSTRAINT IF EXISTS user_integrations_provider_check;
    ALTER TABLE user_integrations
        ADD CONSTRAINT user_integrations_provider_check
        CHECK (provider IN ('strava', 'zepp', 'apple_health', 'samsung_health', 'garmin'));
EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;
`;

const allowSamsungWellnessSource = `
DO $$
BEGIN
    ALTER TABLE daily_wellness DROP CONSTRAINT IF EXISTS daily_wellness_source_check;
    ALTER TABLE daily_wellness
        ADD CONSTRAINT daily_wellness_source_check
        CHECK (source IN ('zepp', 'apple_health', 'samsung_health', 'garmin', 'manual'));
EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;
`;

module.exports = {
    createSamsungHealthSamplesTable,
    createSamsungHealthSamplesIndex,
    allowSamsungHealthProvider,
    allowSamsungWellnessSource,
};
