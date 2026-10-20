const { queryWithHardTimeout } = require('../../lib/dbQuery');
const createUsersTable = require('../../models/Onboarding/UserOnboardingData');

let usersTableReady = false;

async function ensureUsersTable() {
    if (usersTableReady) return;
    await queryWithHardTimeout(createUsersTable, [], 8000);
    usersTableReady = true;
}

function resolveAuthProvider(user) {
    // Prefer explicit provider already on our JWT / DB user.
    if (['google', 'apple', 'email'].includes(user?.auth_provider)) {
        return user.auth_provider;
    }

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

    if (fromApp === 'email' || fromMeta === 'email') {
        return 'email';
    }

    // Supabase OAuth without clear provider metadata (Continue with Google default).
    if (user?.source === 'supabase') {
        return 'google';
    }

    return 'email';
}

/**
 * Store / link any onboarding identity into Neon `users`.
 * - Google / Apple: id + supabase_user_id = Supabase sub, email from token
 * - Email: row already created at signup; this call is idempotent upsert
 * - Same email across providers: link supabase_user_id, keep canonical DB id
 */
async function upsertOnboardingUser({
    userId,
    email,
    authProvider,
    isEmailVerified,
    supabaseUserId = null,
}) {
    const oauthId = supabaseUserId || (authProvider === 'email' ? null : userId);

    const findSql = `
        SELECT id, email, auth_provider, is_email_verified, supabase_user_id, created_at
        FROM users
        WHERE ($1::uuid IS NOT NULL AND (id = $1 OR supabase_user_id = $1))
           OR ($2::uuid IS NOT NULL AND (id = $2 OR supabase_user_id = $2))
           OR email = $3
        ORDER BY CASE
            WHEN $2::uuid IS NOT NULL AND supabase_user_id = $2 THEN 0
            WHEN $1::uuid IS NOT NULL AND id = $1 THEN 1
            WHEN email = $3 THEN 2
            ELSE 3
        END
        LIMIT 1
    `;

    const existing = await queryWithHardTimeout(
        findSql,
        [userId || null, oauthId || null, email],
        8000
    );

    if (existing.rows[0]) {
        const row = existing.rows[0];
        const updated = await queryWithHardTimeout(
            `
            UPDATE users
            SET
                supabase_user_id = CASE
                    WHEN $2::uuid IS NULL THEN users.supabase_user_id
                    ELSE COALESCE(users.supabase_user_id, $2)
                END,
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
            [row.id, oauthId, email, authProvider, isEmailVerified],
            8000
        );
        return updated.rows[0];
    }

    // New row — OAuth uses Supabase sub as PK; email signup should normally already exist.
    const insertId = oauthId || userId;
    if (!insertId) {
        throw new Error('Cannot create user without id');
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
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                NOW()
            )
            RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
            `,
            [
                insertId,
                authProvider === 'email' ? null : insertId,
                email,
                authProvider,
                isEmailVerified,
            ],
            8000
        );
        return inserted.rows[0];
    } catch (error) {
        if (error.code === '23505') {
            const again = await queryWithHardTimeout(
                findSql,
                [userId || null, oauthId || null, email],
                8000
            );
            if (again.rows[0]) {
                const row = again.rows[0];
                const updated = await queryWithHardTimeout(
                    `
                    UPDATE users
                    SET
                        supabase_user_id = CASE
                            WHEN $2::uuid IS NULL THEN users.supabase_user_id
                            ELSE COALESCE(users.supabase_user_id, $2)
                        END,
                        is_email_verified = users.is_email_verified OR $3,
                        updated_at = NOW()
                    WHERE id = $1
                    RETURNING id, email, auth_provider, is_email_verified, supabase_user_id, created_at
                    `,
                    [row.id, oauthId, isEmailVerified],
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
        const userId = user.id;
        const email = String(user.email || '')
            .trim()
            .toLowerCase();

        console.log('UserOnboarding: start', {
            userId,
            email,
            source: user.source,
        });

        if (!userId || !email) {
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
            user.is_email_verified ||
                user.email_confirmed_at ||
                user.user_metadata?.email_verified ||
                authProvider === 'google' ||
                authProvider === 'apple'
        );

        await ensureUsersTable();

        const supabaseUserId =
            user.supabase_user_id ||
            (user.source === 'supabase' ? user.id : null);

        console.log('UserOnboarding: upsert', { authProvider });
        const saved = await upsertOnboardingUser({
            userId,
            email,
            authProvider,
            isEmailVerified,
            supabaseUserId,
        });

        console.log('UserOnboarding: success', {
            ms: Date.now() - startedAt,
            userId: saved?.id,
            authProvider: saved?.auth_provider,
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
