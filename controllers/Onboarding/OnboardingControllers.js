const { queryWithHardTimeout } = require('../../lib/dbQuery');
const createUsersTable = require('../../models/Onboarding/UserOnboardingData');

let usersTableReady = false;

async function ensureUsersTable() {
    if (usersTableReady) return;
    await queryWithHardTimeout(createUsersTable, [], 8000);
    usersTableReady = true;
}

function resolveAuthProvider(user) {
    const fromApp = user?.app_metadata?.provider;
    const fromMeta = user?.user_metadata?.provider;
    const iss = String(user?.user_metadata?.iss || '');
    const providers = user?.app_metadata?.providers;

    if (
        fromApp === 'apple' ||
        fromMeta === 'apple' ||
        (Array.isArray(providers) && providers.includes('apple') && !providers.includes('google'))
    ) {
        return 'apple';
    }

    if (
        fromApp === 'google' ||
        fromMeta === 'google' ||
        iss.includes('accounts.google.com') ||
        (Array.isArray(providers) && providers.includes('google'))
    ) {
        return 'google';
    }

    if (user?.source === 'supabase') {
        return 'google';
    }

    if (fromApp === 'email' || fromMeta === 'email') {
        return 'email';
    }

    return 'email';
}

/**
 * Production upsert:
 * - New Google/Apple user → insert with id = supabase sub
 * - Existing email account → link supabase_user_id, keep canonical DB id (FK-safe)
 * - Concurrent retries → unique-violation safe retry
 * - Always return the canonical users row FE / questions must use
 */
async function upsertOnboardingUser({
    supabaseUserId,
    email,
    authProvider,
    isEmailVerified,
}) {
    const findSql = `
        SELECT id, email, auth_provider, is_email_verified, supabase_user_id, created_at
        FROM users
        WHERE supabase_user_id = $1
           OR id = $1
           OR email = $2
        ORDER BY CASE
            WHEN supabase_user_id = $1 THEN 0
            WHEN id = $1 THEN 1
            ELSE 2
        END
        LIMIT 1
    `;

    const existing = await queryWithHardTimeout(findSql, [supabaseUserId, email], 8000);
    if (existing.rows[0]) {
        const row = existing.rows[0];
        const updated = await queryWithHardTimeout(
            `
            UPDATE users
            SET
                supabase_user_id = COALESCE(users.supabase_user_id, $2),
                email = CASE
                    WHEN users.email = $3 THEN users.email
                    WHEN EXISTS (
                        SELECT 1 FROM users other
                        WHERE other.email = $3 AND other.id <> users.id
                    ) THEN users.email
                    ELSE $3
                END,
                auth_provider = CASE
                    WHEN users.auth_provider = 'email' AND $4 IN ('google', 'apple') THEN $4
                    WHEN $4 IN ('google', 'apple', 'email') THEN $4
                    ELSE users.auth_provider
                END,
                is_email_verified = users.is_email_verified OR $5,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
            `,
            [row.id, supabaseUserId, email, authProvider, isEmailVerified],
            8000
        );
        return updated.rows[0];
    }

    try {
        const inserted = await queryWithHardTimeout(
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
            RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
            `,
            [supabaseUserId, email, authProvider, isEmailVerified],
            8000
        );
        return inserted.rows[0];
    } catch (error) {
        // Concurrent first-login race (unique email / id / supabase_user_id).
        if (error.code === '23505') {
            const again = await queryWithHardTimeout(findSql, [supabaseUserId, email], 8000);
            if (again.rows[0]) {
                const row = again.rows[0];
                const updated = await queryWithHardTimeout(
                    `
                    UPDATE users
                    SET
                        supabase_user_id = COALESCE(users.supabase_user_id, $2),
                        is_email_verified = users.is_email_verified OR $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
                    `,
                    [row.id, supabaseUserId, isEmailVerified],
                    8000
                );
                return updated.rows[0];
            }
        }
        throw error;
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
        if (!['google', 'apple', 'email'].includes(authProvider)) {
            clearTimeout(watchdog);
            return respond(400, { message: 'Unsupported auth provider' });
        }

        const isEmailVerified = Boolean(
            user.email_confirmed_at ||
                user.user_metadata?.email_verified ||
                authProvider === 'google' ||
                authProvider === 'apple'
        );

        await ensureUsersTable();

        console.log('UserOnboarding: upsert', { authProvider });
        const saved = await upsertOnboardingUser({
            supabaseUserId,
            email,
            authProvider,
            isEmailVerified,
        });

        console.log('UserOnboarding: success', {
            ms: Date.now() - startedAt,
            userId: saved?.id,
        });

        clearTimeout(watchdog);
        return respond(200, {
            message: 'User onboarded successfully',
            user: saved,
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
