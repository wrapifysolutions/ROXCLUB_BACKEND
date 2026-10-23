const createSavedWorkoutsTable = `
CREATE TABLE IF NOT EXISTS saved_workouts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    workout_id VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, workout_id)
);
`;

module.exports = { createSavedWorkoutsTable };
