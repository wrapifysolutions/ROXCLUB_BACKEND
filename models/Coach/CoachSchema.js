const alterUsersAccountType = `
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS account_type VARCHAR(20);
`;

const usersAccountTypeCheck = `
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_account_type_check'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_account_type_check
            CHECK (account_type IS NULL OR account_type IN ('athlete', 'coach', 'admin'));
    END IF;
END $$;
`;

const createCoachApplicationsTable = `
CREATE TABLE IF NOT EXISTS coach_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(40) NOT NULL,
    country VARCHAR(80) NOT NULL,
    city VARCHAR(80) NOT NULL,
    specialty VARCHAR(40) NOT NULL,
    years_experience INTEGER NOT NULL,
    qualifications TEXT NOT NULL,
    biography TEXT NOT NULL,
    document_key TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    rejection_reason TEXT,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT coach_applications_status_check
        CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
    CONSTRAINT coach_applications_specialty_check
        CHECK (specialty IN ('HYROX', 'Running', 'Strength', 'Hybrid'))
);
`;

const createCoachApplicationsPendingIndex = `
CREATE UNIQUE INDEX IF NOT EXISTS coach_applications_one_pending_idx
    ON coach_applications (user_id)
    WHERE status = 'pending';
`;

const createCoachApplicationsUserIndex = `
CREATE INDEX IF NOT EXISTS coach_applications_user_created_idx
    ON coach_applications (user_id, created_at DESC);
`;

const createAdminAuditLogTable = `
CREATE TABLE IF NOT EXISTS admin_audit_log (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_user_id UUID REFERENCES users(id),
    action VARCHAR(80) NOT NULL,
    target_user_id UUID,
    target_application_id UUID,
    detail JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const coachStatements = [
    alterUsersAccountType,
    usersAccountTypeCheck,
    createCoachApplicationsTable,
    createCoachApplicationsPendingIndex,
    createCoachApplicationsUserIndex,
    createAdminAuditLogTable,
];

module.exports = { coachStatements };
