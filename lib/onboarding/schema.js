const { queryWithHardTimeout } = require('../dbQuery');
const createUsersTable = require('../../models/Onboarding/UserOnboardingData');
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

let schemaReady = false;

async function ensureOnboardingProfileSchema() {
    if (schemaReady) return;
    await queryWithHardTimeout(createUsersTable, [], 8000);
    await queryWithHardTimeout(createUsersTable.alterUsersProfileColumns, [], 8000);
    await queryWithHardTimeout(createOnboardingQuestionsTable, [], 8000);
    await queryWithHardTimeout(alterOnboardingExtraColumns, [], 8000);
    await queryWithHardTimeout(createBodyMetricsTable, [], 8000);
    await queryWithHardTimeout(createRaceGoalsTable, [], 8000);
    await queryWithHardTimeout(createAthleteProfilesTable, [], 8000);
    schemaReady = true;
}

module.exports = { ensureOnboardingProfileSchema };
