const createStravaAthletesTable = `
CREATE TABLE IF NOT EXISTS strava_athletes (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    athlete_id VARCHAR(64) NOT NULL,
    username VARCHAR(120),
    firstname VARCHAR(120),
    lastname VARCHAR(120),
    city VARCHAR(120),
    country VARCHAR(120),
    sex VARCHAR(20),
    profile_url TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createStravaActivitiesTable = `
CREATE TABLE IF NOT EXISTS strava_activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    strava_activity_id BIGINT NOT NULL,
    name VARCHAR(255),
    sport_type VARCHAR(80),
    activity_type VARCHAR(80),
    start_at TIMESTAMPTZ,
    timezone VARCHAR(80),
    elapsed_time INTEGER,
    moving_time INTEGER,
    distance NUMERIC(14,4),
    total_elevation_gain NUMERIC(12,4),
    average_speed NUMERIC(12,4),
    max_speed NUMERIC(12,4),
    average_heartrate NUMERIC(8,2),
    max_heartrate NUMERIC(8,2),
    calories NUMERIC(10,2),
    map_polyline TEXT,
    raw JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_strava_activity UNIQUE (user_id, strava_activity_id)
);
`;

const createStravaActivitiesIndex = `
CREATE INDEX IF NOT EXISTS idx_strava_activities_user_start
    ON strava_activities (user_id, start_at DESC);
`;

module.exports = {
    createStravaAthletesTable,
    createStravaActivitiesTable,
    createStravaActivitiesIndex,
};
