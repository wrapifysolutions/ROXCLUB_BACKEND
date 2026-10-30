const pool = require('../../lib/pool');
const { ensureOnboardingProfileSchema } = require('../../lib/onboarding/schema');
const { resolveNavigation } = require('../../lib/auth/accountRouting');
const { clearAuthCookie } = require('../../lib/token');
const { loadAuthenticatedUser } = require('../../middlewares/auth.middleware');

function unauthenticated(res, message, clearCookie) {
    if (clearCookie) clearAuthCookie(res);
    return res.status(401).json({
        authenticated: false,
        redirect: '/login',
        message,
    });
}

const GetAuthSession = async (req, res) => {
    try {
        let sessionUser;
        try {
            sessionUser = await loadAuthenticatedUser(req);
        } catch (error) {
            const message =
                error.code === 'SESSION_EXPIRED'
                    ? 'Session expired'
                    : error.code === 'UNAUTHENTICATED'
                      ? 'Not authenticated'
                      : 'Unauthorized Access';
            return unauthenticated(res, message, error.code === 'SESSION_EXPIRED');
        }

        await ensureOnboardingProfileSchema();

        const { rows } = await pool.query(
            `
            SELECT
                u.id,
                u.email,
                u.auth_provider,
                u.is_email_verified,
                u.account_type,
                (u.onboarding_completed IS TRUE OR oq.is_completed IS TRUE) AS onboarding_is_completed,
                coach.status AS coach_status
            FROM users u
            LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
            LEFT JOIN LATERAL (
                SELECT status
                FROM coach_applications
                WHERE user_id = u.id
                ORDER BY created_at DESC
                LIMIT 1
            ) coach ON TRUE
            WHERE u.id = $1
            `,
            [sessionUser.id]
        );

        const user = rows[0];

        if (!user) {
            if (sessionUser.source !== 'supabase') {
                return unauthenticated(res, 'Not authenticated', true);
            }
            const navigation = resolveNavigation({});
            return res.status(200).json({
                authenticated: true,
                redirect: '/role-selection',
                next: navigation.next,
                navigation,
                user: {
                    id: sessionUser.id,
                    email: sessionUser.email,
                    auth_provider: sessionUser.auth_provider,
                    onboarding_completed: false,
                    account_type: null,
                    permissions: navigation.permissions,
                },
            });
        }

        if (!user.is_email_verified && user.auth_provider === 'email') {
            return unauthenticated(res, 'Not authenticated', true);
        }

        const onboardingCompleted = Boolean(user.onboarding_is_completed);
        const navigation = resolveNavigation({
            accountType: user.account_type,
            onboardingCompleted,
            coachStatus: user.coach_status,
        });
        const redirect =
            navigation.next === 'home'
                ? '/home'
                : navigation.next === 'onboarding' || navigation.next === 'role_selection'
                  ? '/onboarding/name'
                  : `/${navigation.next}`;

        return res.status(200).json({
            authenticated: true,
            redirect: onboardingCompleted ? '/home' : navigation.next === 'role_selection' ? '/role-selection' : redirect,
            next: navigation.next,
            navigation,
            user: {
                id: user.id,
                email: user.email,
                auth_provider: user.auth_provider,
                onboarding_completed: onboardingCompleted,
                account_type: navigation.accountType,
                permissions: navigation.permissions,
            },
        });
    } catch (error) {
        console.error('GetAuthSession error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

const Logout = async (req, res) => {
    clearAuthCookie(res);
    return res.status(200).json({
        message: 'Logged out successfully',
        redirect: '/login',
    });
};

module.exports = { GetAuthSession, Logout };
