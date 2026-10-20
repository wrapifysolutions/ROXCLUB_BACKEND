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
    return fromApp || fromMeta || 'email';
}

async function queryWithHardTimeout(text, params, timeoutMs = 10000) {
    return Promise.race([
        pool.query(text, params),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`DB query timed out after ${timeoutMs}ms`)),
                timeoutMs
            );
        }),
    ]);
}

const UserOnboarding = async (req, res) => {
    const startedAt = Date.now();
    let responded = false;

    const respond = (status, body) => {
        if (responded || res.headersSent) return;
        responded = true;
        return res.status(status).json(body);
    };

    // Absolute safety net so the client never waits forever.
    const watchdog = setTimeout(() => {
        console.error('UserOnboarding: watchdog fired', { ms: Date.now() - startedAt });
        respond(503, {
            message: 'Onboarding timed out',
            detail: 'Server failed to finish within 20s',
        });
    }, 20000);

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
            clearTimeout(watchdog);
            return respond(400, {
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

        console.log('UserOnboarding: create table');
        await queryWithHardTimeout(createUsersTable, [], 10000);

        console.log('UserOnboarding: upsert', { authProvider });
        const { rows } = await queryWithHardTimeout(
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
            [supabaseUserId, email, authProvider, isEmailVerified],
            10000
        );

        console.log('UserOnboarding: success', {
            ms: Date.now() - startedAt,
            userId: rows[0]?.id,
        });

        clearTimeout(watchdog);
        return respond(200, {
            message: 'User onboarded successfully',
            user: rows[0],
        });
    } catch (error) {
        console.error('UserOnboarding error', {
            ms: Date.now() - startedAt,
            message: error.message,
            code: error.code,
        });
        clearTimeout(watchdog);
        return respond(500, {
            message: 'Internal Server Error',
            detail: error.message,
        });
    }
};

module.exports = UserOnboarding;
