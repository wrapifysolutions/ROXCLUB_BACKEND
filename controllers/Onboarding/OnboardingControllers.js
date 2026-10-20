const pool = require('../../lib/pool');
const createUsersTable = require('../../models/Onboarding/UserOnboardingData');

function resolveAuthProvider(user) {
    const fromApp = user?.app_metadata?.provider;
    const fromMeta = user?.user_metadata?.provider;
    const iss = String(user?.user_metadata?.iss || '');

    if (fromApp === 'google' || fromMeta === 'google' || iss.includes('accounts.google.com')) {
        return 'google';
    }
    if (fromApp === 'apple' || fromMeta === 'apple') {
        return 'apple';
    }
    if (fromApp === 'email' || fromMeta === 'email') {
        return 'email';
    }
    return fromApp || fromMeta || 'email';
}

const UserOnboarding = async (req, res) => {
    const startedAt = Date.now();
    try {
        const user = req.user || {};
        const supabaseUserId = user.id;
        const email = String(user.email || '')
            .trim()
            .toLowerCase();

        console.log('UserOnboarding: start', {
            supabaseUserId,
            email,
            source: user.source,
        });

        if (!supabaseUserId || !email) {
            return res.status(400).json({
                message: 'Authenticated user is missing id or email',
            });
        }

        const authProvider = resolveAuthProvider(user);
        const isEmailVerified = Boolean(
            user.email_confirmed_at ||
                user.user_metadata?.email_verified ||
                authProvider === 'google' ||
                authProvider === 'apple'
        );

        console.log('UserOnboarding: ensure users table');
        await pool.query(createUsersTable);

        console.log('UserOnboarding: upsert user', { authProvider, isEmailVerified });
        const { rows } = await pool.query(
            `
            INSERT INTO users (
                id,
                supabase_user_id,
                email,
                auth_provider,
                is_email_verified,
                updated_at
            )
            VALUES ($1, $1, $2, $3, $4, NOW())
            ON CONFLICT (email)
            DO UPDATE SET
                supabase_user_id = COALESCE(users.supabase_user_id, EXCLUDED.supabase_user_id),
                auth_provider = EXCLUDED.auth_provider,
                is_email_verified = EXCLUDED.is_email_verified OR users.is_email_verified,
                updated_at = NOW()
            RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
            `,
            [supabaseUserId, email, authProvider, isEmailVerified]
        );

        console.log('UserOnboarding: success', {
            ms: Date.now() - startedAt,
            userId: rows[0]?.id,
        });

        return res.status(200).json({
            message: 'User onboarded successfully',
            user: rows[0],
        });
    } catch (error) {
        console.error('UserOnboarding error', {
            ms: Date.now() - startedAt,
            message: error.message,
            code: error.code,
            detail: error.detail,
        });
        return res.status(500).json({
            message: 'Internal Server Error',
            detail: error.message,
        });
    }
};

module.exports = UserOnboarding;
