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
        iss.includes('supabase.co') ||
        iss.includes('supabase') ||
        Boolean(payload.sub && payload.role) ||
        Boolean(payload.amr)
    );
}

async function queryUserById(userId, timeoutMs = 5000) {
    const connectMs = Math.min(timeoutMs, 4000);
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
        return await client.query(
            `
            SELECT id, email, auth_provider, is_email_verified
            FROM users
            WHERE id = $1
            `,
            [userId]
        );
    } finally {
        client.release();
    }
}

const authMiddleware = async (req, res, next) => {
    const startedAt = Date.now();
    let responded = false;

    const fail = (status, body) => {
        if (responded || res.headersSent) return;
        responded = true;
        return res.status(status).json(body);
    };

    // Never let auth hang past this — FE connectTimeout is ~20s.
    const watchdog = setTimeout(() => {
        console.error('auth: watchdog fired', { ms: Date.now() - startedAt, path: req.path });
        fail(503, {
            message: 'Authentication timed out',
            detail: 'Auth did not finish within 8s',
        });
    }, 8000);

    try {
        console.log('auth: start', req.method, req.path);

        const cookieToken = req.cookies?.[COOKIE_NAME];
        if (cookieToken) {
            try {
                const payload = verifyAccessToken(cookieToken);
                const { rows } = await queryUserById(payload.sub);
                const user = rows[0];
                if (!user || !user.is_email_verified) {
                    clearTimeout(watchdog);
                    return fail(401, { message: 'Unauthorized Access' });
                }
                req.user = {
                    id: user.id,
                    email: user.email,
                    auth_provider: user.auth_provider,
                    source: 'cookie',
                };
                clearTimeout(watchdog);
                return next();
            } catch (error) {
                console.error('auth: cookie failed', error.message);
                clearTimeout(watchdog);
                return fail(401, { message: 'Unauthorized Access' });
            }
        }

        const authorization = req.headers.authorization;
        if (!authorization?.startsWith('Bearer ')) {
            clearTimeout(watchdog);
            return fail(401, { message: 'Unauthorized Access' });
        }

        const token = authorization.slice(7);

        // Google/Apple Supabase token — JWKS local verify (no hanging Auth call).
        if (isLikelySupabaseToken(token)) {
            console.log('auth: supabase token detected', {
                ms: Date.now() - startedAt,
                tokenLen: token.length,
            });
            const { data, error } = await getSupabaseUser(token, 5000);
            if (error || !data?.user) {
                console.error('auth: supabase invalid', error?.message || error);
                clearTimeout(watchdog);
                return fail(401, {
                    message: 'Unauthorized Access',
                    detail: error?.message,
                });
            }
            console.log('auth: supabase ok', data.user.id, data.user.email, {
                ms: Date.now() - startedAt,
            });
            req.user = data.user;
            req.user.source = 'supabase';
            clearTimeout(watchdog);
            return next();
        }

        // Email-login RoxClub JWT
        try {
            const payload = verifyAccessToken(token);
            const { rows } = await queryUserById(payload.sub);
            const user = rows[0];
            if (user && user.is_email_verified) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    auth_provider: user.auth_provider,
                    source: 'jwt',
                };
                clearTimeout(watchdog);
                return next();
            }
        } catch (error) {
            console.error('auth: jwt failed', error.message);
        }

        clearTimeout(watchdog);
        return fail(401, { message: 'Unauthorized Access' });
    } catch (error) {
        console.error('auth: fatal', error);
        clearTimeout(watchdog);
        return fail(500, { message: 'Authentication Error', detail: error.message });
    }
};

module.exports = authMiddleware;
