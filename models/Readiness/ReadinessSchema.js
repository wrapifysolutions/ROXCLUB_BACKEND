const alterReadinessCheckins = `
ALTER TABLE readiness_checkins
    ADD COLUMN IF NOT EXISTS local_date DATE,
    ADD COLUMN IF NOT EXISTS energy SMALLINT,
    ADD COLUMN IF NOT EXISTS soreness SMALLINT,
    ADD COLUMN IF NOT EXISTS sleep_quality SMALLINT,
    ADD COLUMN IF NOT EXISTS stress SMALLINT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

const relaxLegacyCheckinColumns = `
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'readiness_checkins'
          AND column_name = 'score'
    ) THEN
        EXECUTE 'ALTER TABLE readiness_checkins ALTER COLUMN score DROP NOT NULL';
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'readiness_checkins'
          AND column_name = 'checked_on'
    ) THEN
        EXECUTE 'ALTER TABLE readiness_checkins ALTER COLUMN checked_on DROP NOT NULL';
        EXECUTE $backfill$
            UPDATE readiness_checkins
            SET local_date = checked_on
            WHERE local_date IS NULL AND checked_on IS NOT NULL
        $backfill$;
    END IF;
END $$;
`;

const createReadinessCheckinDateIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS readiness_checkins_user_local_date_uidx
    ON readiness_checkins (user_id, local_date);
`;

const createCheckinPromptsTable = `
CREATE TABLE IF NOT EXISTS checkin_prompts (
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    local_date DATE NOT NULL,
    status VARCHAR(20) NOT NULL
        CHECK (status IN ('dismissed', 'completed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, local_date)
);
`;

const createDailyWellnessTable = `
CREATE TABLE IF NOT EXISTS daily_wellness (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    local_date DATE NOT NULL,
    source VARCHAR(20) NOT NULL
        CHECK (source IN ('zepp', 'apple_health', 'manual')),
    sleep_minutes INTEGER,
    sleep_score INTEGER,
    hrv_ms NUMERIC(8,2),
    resting_hr NUMERIC(6,2),
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, local_date, source)
);
`;

const createDailyReadinessTable = `
CREATE TABLE IF NOT EXISTS daily_readiness (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    local_date DATE NOT NULL,
    score INTEGER,
    status VARCHAR(30) NOT NULL
        CHECK (status IN (
            'CALIBRATING',
            'PRIMED',
            'READY',
            'MODERATE',
            'FATIGUED',
            'RECOVERY_NEEDED'
        )),
    confidence VARCHAR(20) NOT NULL
        CHECK (confidence IN ('LOW', 'MODERATE', 'HIGH')),
    signals_used JSONB NOT NULL DEFAULT '{}'::jsonb,
    model_version VARCHAR(20) NOT NULL DEFAULT 'v0',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, local_date)
);
`;

module.exports = {
    alterReadinessCheckins,
    relaxLegacyCheckinColumns,
    createReadinessCheckinDateIndex,
    createCheckinPromptsTable,
    createDailyReadinessTable,
    createDailyWellnessTable,
};
