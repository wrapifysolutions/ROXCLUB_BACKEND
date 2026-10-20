/**
 * Neon `users` — single source of truth for RoxClub onboarding identity.
 *
 * Who writes here:
 * - google / apple → POST /onboarding (after Supabase session)
 * - email         → POST /auth/email-signup (then verify OTP)
 *
 * Every onboarding email (Google, Apple, or custom) must end up in this table.
 */
const createUsersTable = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Supabase Auth user id (Google / Apple). NULL for custom email signup.
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
