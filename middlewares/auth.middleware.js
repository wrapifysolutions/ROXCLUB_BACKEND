const { getSupabaseUser } = require('../lib/SupabaseConfig');
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
            } catch (error) {
                console.error('Cookie auth failed', error.message);
                return res.status(401).json({ message: 'Unauthorized Access' });
            }
        }

        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const token = authorization.slice(7);

        // 1) Our RoxClub JWT (email auth)
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
            // Not our JWT — try Supabase below.
        }

        // 2) Supabase access token (Google / Apple)
        console.log('authMiddleware: verifying supabase token');
        let data;
        let error;
        try {
            ({ data, error } = await getSupabaseUser(token, 8000));
        } catch (timeoutError) {
            console.error('authMiddleware: supabase getUser failed', timeoutError.message);
            return res.status(503).json({
                message: 'Auth provider timeout',
                detail: timeoutError.message,
            });
        }

        if (error || !data?.user) {
            console.error('authMiddleware: supabase user invalid', error?.message || error);
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        console.log('authMiddleware: supabase user ok', data.user.id, data.user.email);
        req.user = data.user;
        req.user.source = 'supabase';
        return next();
    } catch (error) {
        console.error('authMiddleware fatal', error);
        return res.status(500).json({ message: 'Authentication Error' });
    }
};

module.exports = authMiddleware;
