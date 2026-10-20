const pool = require('../../lib/pool');

function resolveAuthProvider(user) {
    const fromApp = user?.app_metadata?.provider;
    const fromMeta = user?.user_metadata?.provider;
    const iss = String(user?.user_metadata?.iss || '');
    const providers = user?.app_metadata?.providers;

    if (
        fromApp === 'google' ||
        fromMeta === 'google' ||
        iss.includes('accounts.google.com') ||
        (Array.isArray(providers) && providers.includes('google'))
    ) {
        return 'google';
    }
    if (
        fromApp === 'apple' ||
        fromMeta === 'apple' ||
        (Array.isArray(providers) && providers.includes('apple'))
    ) {
        return 'apple';
    }
    if (user?.source === 'supabase') {
        return 'google';
    }
    return fromApp || fromMeta || 'email';
}

async function queryWithHardTimeout(text, params, timeoutMs = 8000) {
    const connectMs = Math.min(timeoutMs, 5000);
    const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => {
            setTimeout(
                () => reject(new Error(`DB connect timed out after ${connectMs}ms`)),
                connectMs
            );
        }),
    ]);

    try {
        await client.query(`SET statement_timeout = ${Math.max(1000, timeoutMs)}`);
        return await client.query(text, params);
    } finally {
        client.release();
    }
}

const UserOnboarding = async (req, res) => {
    const startedAt = Date.now();
    let responded = false;

    const respond = (status, body) => {
        if (responded || res.headersSent) return;
        responded = true;
        return res.status(status).json(body);
    };

    const watchdog = setTimeout(() => {
        console.error('UserOnboarding: watchdog fired', { ms: Date.now() - startedAt });
        respond(503, {
            message: 'Onboarding timed out',
            detail: 'Server failed to finish within 12s',
        });
    }, 12000);

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

        // Table is created at boot / migrations — do not CREATE TABLE on every request
        // (catalog locks on Neon can stall the single Vercel pool client).
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
            8000
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
