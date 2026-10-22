const pool = require('../../lib/pool');
const { ensureOnboardingProfileSchema } = require('../../lib/onboarding/schema');
const {
    verifyAccessToken,
    clearAuthCookie,
    readTokenFromRequest,
} = require('../../lib/token');

const GetAuthSession = async (req, res) => {
    try {
        const token = readTokenFromRequest(req);

        if (!token) {
            return res.status(401).json({
                authenticated: false,
                redirect: '/login',
                message: 'Not authenticated',
            });
        }

        let payload;
        try {
            payload = verifyAccessToken(token);
        } catch (_) {
            clearAuthCookie(res);
            return res.status(401).json({
                authenticated: false,
                redirect: '/login',
                message: 'Session expired',
            });
        }

        await ensureOnboardingProfileSchema();

        const { rows } = await pool.query(
            `
            SELECT
                u.id,
                u.email,
                u.auth_provider,
                u.is_email_verified,
                (u.onboarding_completed IS TRUE OR oq.is_completed IS TRUE) AS onboarding_is_completed
            FROM users u
            LEFT JOIN onboarding_questions oq ON oq.user_id = u.id
            WHERE u.id = $1
            `,
            [payload.sub]
        );

        const user = rows[0];

        if (!user || !user.is_email_verified) {
            clearAuthCookie(res);
            return res.status(401).json({
                authenticated: false,
                redirect: '/login',
                message: 'Not authenticated',
            });
        }

        const onboardingCompleted = Boolean(user.onboarding_is_completed);

        return res.status(200).json({
            authenticated: true,
            redirect: onboardingCompleted ? '/home' : '/onboarding/name',
            user: {
                id: user.id,
                email: user.email,
                auth_provider: user.auth_provider,
                onboarding_completed: onboardingCompleted,
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
