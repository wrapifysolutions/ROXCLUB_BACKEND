const createClubsTable = `
CREATE TABLE IF NOT EXISTS clubs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    specialty VARCHAR(40) NOT NULL,
    location VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT clubs_specialty_check
        CHECK (specialty IN ('HYROX', 'Running', 'Strength', 'Hybrid'))
);
`;

const createClubMembershipsTable = `
CREATE TABLE IF NOT EXISTS club_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    athlete_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT club_memberships_status_check
        CHECK (status IN ('pending', 'accepted', 'declined'))
);
`;

const createClubMembershipIndexes = `
CREATE UNIQUE INDEX IF NOT EXISTS club_memberships_one_pending_idx
    ON club_memberships (athlete_user_id, club_id)
    WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS club_memberships_one_accepted_idx
    ON club_memberships (athlete_user_id)
    WHERE status = 'accepted';
CREATE INDEX IF NOT EXISTS club_memberships_club_status_idx
    ON club_memberships (club_id, status, requested_at DESC);
`;

const createCoachProgramsTable = `
CREATE TABLE IF NOT EXISTS coach_programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    coach_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(140) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    training_goal VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coach_programs_status_check
        CHECK (status IN ('draft', 'club'))
);
`;

const createCoachProgramVersionsTable = `
CREATE TABLE IF NOT EXISTS coach_program_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
    version_no INTEGER NOT NULL,
    duration_weeks INTEGER NOT NULL,
    frozen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (program_id, version_no)
);
`;

const createCoachProgramSessionsTable = `
CREATE TABLE IF NOT EXISTS coach_program_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES coach_program_versions(id) ON DELETE CASCADE,
    week_number INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    workout_id VARCHAR(60) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (version_id, week_number, day_of_week),
    CONSTRAINT coach_program_sessions_day_check
        CHECK (day_of_week BETWEEN 1 AND 7),
    CONSTRAINT coach_program_sessions_week_check
        CHECK (week_number >= 1)
);
`;

const createClubBroadcastsTable = `
CREATE TABLE IF NOT EXISTS club_broadcasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES coach_program_versions(id) ON DELETE CASCADE,
    apply_to_future_members BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (club_id, version_id)
);
`;

const createProgramAssignmentsTable = `
CREATE TABLE IF NOT EXISTS program_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES coach_programs(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES coach_program_versions(id) ON DELETE CASCADE,
    club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    athlete_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source VARCHAR(20) NOT NULL,
    broadcast_id UUID REFERENCES club_broadcasts(id),
    assigned_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (version_id, athlete_user_id),
    CONSTRAINT program_assignments_source_check
        CHECK (source IN ('targeted', 'broadcast'))
);
`;

const alterUserProgramsCoachVersion = `
ALTER TABLE user_programs
    ADD COLUMN IF NOT EXISTS coach_program_version_id UUID;
`;

const linkUserProgramCoachVersion = `
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_programs_coach_version_fk'
    ) THEN
        ALTER TABLE user_programs
            ADD CONSTRAINT user_programs_coach_version_fk
            FOREIGN KEY (coach_program_version_id)
            REFERENCES coach_program_versions(id);
    END IF;
END $$;
`;

const clubStatements = [
    createClubsTable,
    createClubMembershipsTable,
    createClubMembershipIndexes,
    createCoachProgramsTable,
    createCoachProgramVersionsTable,
    createCoachProgramSessionsTable,
    createClubBroadcastsTable,
    createProgramAssignmentsTable,
    alterUserProgramsCoachVersion,
    linkUserProgramCoachVersion,
];

module.exports = { clubStatements };
