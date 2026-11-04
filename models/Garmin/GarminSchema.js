const ALL_PROVIDERS = "('strava', 'zepp', 'apple_health', 'samsung_health', 'garmin')";

const allowGarminProvider = `
DO $$
BEGIN
    ALTER TABLE user_integrations DROP CONSTRAINT IF EXISTS user_integrations_provider_check;
    ALTER TABLE user_integrations
        ADD CONSTRAINT user_integrations_provider_check
        CHECK (provider IN ${ALL_PROVIDERS});
    ALTER TABLE oauth_states DROP CONSTRAINT IF EXISTS oauth_states_provider_check;
    ALTER TABLE oauth_states
        ADD CONSTRAINT oauth_states_provider_check
        CHECK (provider IN ${ALL_PROVIDERS});
    ALTER TABLE oauth_states ADD COLUMN IF NOT EXISTS code_verifier TEXT;
EXCEPTION
    WHEN undefined_table THEN NULL;
    WHEN duplicate_object THEN NULL;
END $$;
`;

const allowGarminWellnessSource = `
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

const createGarminHealthSamplesTable = `
CREATE TABLE IF NOT EXISTS garmin_health_samples (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID
        REFERENCES users(id) ON DELETE CASCADE,
    provider_user_id VARCHAR(255),
    sample_type VARCHAR(40) NOT NULL
        CHECK (sample_type IN ('activity', 'hrv', 'sleep', 'steps', 'resting_hr')),
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
    CONSTRAINT unique_garmin_sample UNIQUE (sample_type, external_id)
);
`;

const createGarminHealthSamplesIndex = `
CREATE INDEX IF NOT EXISTS idx_garmin_health_samples_user_start
    ON garmin_health_samples (user_id, sample_type, start_at DESC);
`;

module.exports = {
    allowGarminProvider,
    allowGarminWellnessSource,
    createGarminHealthSamplesTable,
    createGarminHealthSamplesIndex,
};
