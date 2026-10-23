const { queryWithHardTimeout } = require('../dbQuery');
const {
    createUsersTable,
    alterUsersProfileColumns,
} = require('../../models/Onboarding/UserOnboardingData');
const {
    createOnboardingQuestionsTable,
    alterOnboardingExtraColumns,
} = require('../../models/Onboarding/OnboardingQuestions');

const createBodyMetricsTable = `
CREATE TABLE IF NOT EXISTS body_metrics (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    weight_kg NUMERIC(6,2),
    height_cm NUMERIC(5,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const createRaceGoalsTable = `
CREATE TABLE IF NOT EXISTS race_goals (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    event VARCHAR(80) NOT NULL,
    event_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const createAthleteProfilesTable = `
CREATE TABLE IF NOT EXISTS athlete_profiles (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    program_key VARCHAR(60) NOT NULL,
    program_name VARCHAR(80) NOT NULL,
    dna_status VARCHAR(30) NOT NULL DEFAULT 'CALIBRATING',
    level INTEGER NOT NULL DEFAULT 1,
    xp INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const createAthleteDnaTable = `
CREATE TABLE IF NOT EXISTS athlete_dna (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'CALIBRATING',
    model_version VARCHAR(20) NOT NULL DEFAULT 'v0',
    attributes JSONB,
    strength NUMERIC,
    engine NUMERIC,
    endurance NUMERIC,
    power NUMERIC,
    mobility NUMERIC,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createXpLedgerTable = `
CREATE TABLE IF NOT EXISTS xp_ledger (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    xp INTEGER NOT NULL,
    reason VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createScheduledSessionsTable = `
CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    program_id VARCHAR(60) NOT NULL,
    workout_id VARCHAR(60) NOT NULL,
    title VARCHAR(120) NOT NULL,
    duration_min INTEGER NOT NULL,
    scheduled_on DATE NOT NULL,
    plan_day VARCHAR(3) NOT NULL,
    week_number INTEGER NOT NULL DEFAULT 1,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, scheduled_on)
);
`;

const alterAthleteDnaColumns = `
ALTER TABLE athlete_dna
    ADD COLUMN IF NOT EXISTS model_version VARCHAR(20) DEFAULT 'v0',
    ADD COLUMN IF NOT EXISTS strength NUMERIC,
    ADD COLUMN IF NOT EXISTS engine NUMERIC,
    ADD COLUMN IF NOT EXISTS endurance NUMERIC,
    ADD COLUMN IF NOT EXISTS power NUMERIC,
    ADD COLUMN IF NOT EXISTS mobility NUMERIC;
`;

const alterScheduledSessionColumns = `
ALTER TABLE scheduled_sessions
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
`;

const createUserProgramsTable = `
CREATE TABLE IF NOT EXISTS user_programs (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    program_id VARCHAR(60) NOT NULL,
    start_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createReadinessCheckinsTable = `
CREATE TABLE IF NOT EXISTS readiness_checkins (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    checked_on DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, checked_on)
);
`;

let schemaReady = false;

async function ensureOnboardingProfileSchema() {
    if (schemaReady) return;
    await queryWithHardTimeout(createUsersTable, [], 8000);
    await queryWithHardTimeout(alterUsersProfileColumns, [], 8000);
    await queryWithHardTimeout(createOnboardingQuestionsTable, [], 8000);
    await queryWithHardTimeout(alterOnboardingExtraColumns, [], 8000);
    await queryWithHardTimeout(createBodyMetricsTable, [], 8000);
    await queryWithHardTimeout(createRaceGoalsTable, [], 8000);
    await queryWithHardTimeout(createAthleteProfilesTable, [], 8000);
    await queryWithHardTimeout(createAthleteDnaTable, [], 8000);
    await queryWithHardTimeout(createXpLedgerTable, [], 8000);
    await queryWithHardTimeout(createScheduledSessionsTable, [], 8000);
    await queryWithHardTimeout(alterAthleteDnaColumns, [], 8000);
    await queryWithHardTimeout(alterScheduledSessionColumns, [], 8000);
    await queryWithHardTimeout(createUserProgramsTable, [], 8000);
    await queryWithHardTimeout(createReadinessCheckinsTable, [], 8000);
    schemaReady = true;
}

module.exports = { ensureOnboardingProfileSchema };
