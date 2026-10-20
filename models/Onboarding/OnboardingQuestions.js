const createOnboardingQuestionsTable = `
CREATE TABLE IF NOT EXISTS onboarding_questions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    user_id UUID UNIQUE NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    display_name VARCHAR(100),
    date_of_birth DATE,
    gender VARCHAR(20),
    height NUMERIC(5,2),
    weight NUMERIC(6,2),
    training_experience VARCHAR(30),
    training_goals VARCHAR(100),

    -- Step 5: Create your athlete (avatar)
    avatar_smile VARCHAR(50),
    avatar_hair VARCHAR(50),
    avatar_kit VARCHAR(50),
    avatar_skin_tone VARCHAR(30),
    avatar_skipped BOOLEAN DEFAULT FALSE,

    is_completed BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

const alterOnboardingAvatarColumns = `
ALTER TABLE onboarding_questions
    ADD COLUMN IF NOT EXISTS avatar_smile VARCHAR(50),
    ADD COLUMN IF NOT EXISTS avatar_hair VARCHAR(50),
    ADD COLUMN IF NOT EXISTS avatar_kit VARCHAR(50),
    ADD COLUMN IF NOT EXISTS avatar_skin_tone VARCHAR(30),
    ADD COLUMN IF NOT EXISTS avatar_skipped BOOLEAN DEFAULT FALSE;
`;

module.exports = {
    createOnboardingQuestionsTable,
    alterOnboardingAvatarColumns,
};
