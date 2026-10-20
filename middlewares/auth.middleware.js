const { getSupabaseUser } = require('../lib/SupabaseConfig');
const pool = require('../lib/pool');
const { verifyAccessToken, COOKIE_NAME } = require('../lib/token');

function peekJwtPayload(token) {
    try {
        const part = String(token).split('.')[1];
        if (!part) return null;
        const json = Buffer.from(part, 'base64url').toString('utf8');
        return JSON.parse(json);
    } catch (_) {
        return null;
    }
}

function isLikelySupabaseToken(token) {
    const payload = peekJwtPayload(token);
    if (!payload) return false;
    const iss = String(payload.iss || '');
    return (
        iss.includes('supabase') ||
        Boolean(payload.sub && payload.role) ||
        Boolean(payload.amr)
    );
}

const authMiddleware = async (req, res, next) => {
    const startedAt = Date.now();
    try {
        console.log('auth: start', req.method, req.path);

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
                console.error('auth: cookie failed', error.message);
                return res.status(401).json({ message: 'Unauthorized Access' });
            }
        }

        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const token = authorization.slice(7);

        // Google/Apple: skip RoxClub JWT+DB path so we never hang on pool before Supabase.
        if (isLikelySupabaseToken(token)) {
            console.log('auth: supabase token detected', { ms: Date.now() - startedAt });
            const { data, error } = await getSupabaseUser(token, 6000);
            if (error || !data?.user) {
                console.error('auth: supabase invalid', error?.message || error);
                return res.status(401).json({
                    message: 'Unauthorized Access',
                    detail: error?.message,
                });
            }
            console.log('auth: supabase ok', data.user.id, data.user.email, {
                ms: Date.now() - startedAt,
            });
            req.user = data.user;
            req.user.source = 'supabase';
            return next();
        }

        // Email-login RoxClub JWT
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
        } catch (error) {
            console.error('auth: jwt failed', error.message);
        }

        return res.status(401).json({ message: 'Unauthorized Access' });
    } catch (error) {
        console.error('auth: fatal', error);
        return res.status(500).json({ message: 'Authentication Error' });
    }
};

module.exports = authMiddleware;
