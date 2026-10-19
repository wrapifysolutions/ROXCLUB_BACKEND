const pool = require('../../lib/pool');
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

        const { rows } = await pool.query(
            `
            SELECT id, email, auth_provider, is_email_verified
            FROM users
            WHERE id = $1
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

        return res.status(200).json({
            authenticated: true,
            redirect: '/home',
            user: {
                id: user.id,
                email: user.email,
                auth_provider: user.auth_provider,
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
