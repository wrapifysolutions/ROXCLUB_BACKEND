const SupabaseConfig = require('../lib/SupabaseConfig');
const pool = require('../lib/pool');
const { verifyAccessToken, COOKIE_NAME } = require('../lib/token');

const authMiddleware = async (req, res, next) => {
    try {
        const cookieToken = req.cookies?.[COOKIE_NAME];

        if (cookieToken) {
            try {
                const payload = verifyAccessToken(cookieToken);
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
                    return res.status(401).json({ message: 'Unauthorized Access' });
                }

                req.user = {
                    id: user.id,
                    email: user.email,
                    auth_provider: user.auth_provider,
                    source: 'cookie',
                };
                return next();
            } catch (_) {
                return res.status(401).json({ message: 'Unauthorized Access' });
            }
        }

        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const token = authorization.slice(7);

        try {
            const payload = verifyAccessToken(token);
            const { rows } = await pool.query(
                `
                SELECT id, email, auth_provider, is_email_verified
                FROM users
                WHERE id = $1
                `,
                [payload.sub]
            );

            const user = rows[0];
            if (user && user.is_email_verified) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    auth_provider: user.auth_provider,
                    source: 'jwt',
                };
                return next();
            }
        } catch (_) {
           
        }

        const { data, error } = await SupabaseConfig.auth.getUser(token);
        if (error || !data.user) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        req.user = data.user;
        req.user.source = 'supabase';
        return next();
    } catch (error) {
        return res.status(500).json({ message: 'Authentication Error' });
    }
};

module.exports = authMiddleware;
