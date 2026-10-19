const createUsersTable = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    supabase_user_id UUID UNIQUE,

    email VARCHAR(255) NOT NULL UNIQUE,

    password_hash TEXT,

    otp_hash TEXT,
    otp_expires_at TIMESTAMPTZ,

    auth_provider VARCHAR(30) NOT NULL
        CHECK (auth_provider IN ('google', 'apple', 'email')),

    is_email_verified BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
`;

module.exports = createUsersTable;
