
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

    is_completed BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = createOnboardingQuestionsTable;
