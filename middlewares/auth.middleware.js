const { getSupabaseUser } = require('../lib/SupabaseConfig');
const { queryWithHardTimeout } = require('../lib/dbQuery');
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
    // Supabase access tokens always carry iss + role=authenticated (or similar).
    return (
        iss.includes('supabase.co') ||
        (Boolean(payload.sub) &&
            Boolean(payload.role) &&
            (payload.role === 'authenticated' || payload.role === 'anon'))
    );
}

/** Extract Bearer token (case-insensitive). Also accepts x-access-token. */
function extractBearerToken(req) {
    const rawAuth = req.headers.authorization || req.headers.Authorization;
    if (typeof rawAuth === 'string') {
        const match = rawAuth.match(/^Bearer\s+(.+)$/i);
        if (match?.[1]) {
            let token = match[1].trim();
            // Guard: "Bearer Bearer <jwt>" from double interceptors
            if (/^Bearer\s+/i.test(token)) {
                token = token.replace(/^Bearer\s+/i, '').trim();
            }
            if (token) return token;
        }
    }

    const alt =
        req.headers['x-access-token'] ||
        req.headers['x-supabase-access-token'];
    if (typeof alt === 'string' && alt.trim()) {
        return alt.trim();
    }

    return null;
}

async function findDbUser({ supabaseUserId, email }) {
    const { rows } = await queryWithHardTimeout(
        `
        SELECT id, email, auth_provider, is_email_verified, supabase_user_id
        FROM users
        WHERE ($1::uuid IS NOT NULL AND (supabase_user_id = $1 OR id = $1))
           OR ($2::text IS NOT NULL AND email = $2)
        ORDER BY CASE
            WHEN supabase_user_id = $1 THEN 0
            WHEN id = $1 THEN 1
            ELSE 2
        END
        LIMIT 1
        `,
        [supabaseUserId || null, email || null],
        5000
    );
    return rows[0] || null;
}

function providerFromSupabaseUser(sbUser) {
    const provider = String(
        sbUser?.app_metadata?.provider || sbUser?.identities?.[0]?.provider || ''
    )
        .trim()
        .toLowerCase();
    if (provider === 'google' || provider === 'apple' || provider === 'email') return provider;
    return null;
}

async function loadAuthenticatedUser(req) {
    const bearer = extractBearerToken(req);
    const cookieToken = req.cookies?.[COOKIE_NAME];

    if (bearer && isLikelySupabaseToken(bearer)) {
        const { data, error } = await getSupabaseUser(bearer, 5000);
        if (error || !data?.user?.id) {
            const failure = new Error(error?.message || 'Unauthorized Access');
            failure.status = 401;
            failure.code = 'UNAUTHORIZED';
            throw failure;
        }
        const sbUser = data.user;
        const email = String(sbUser.email || '').trim().toLowerCase();
        let dbUser = null;
        try {
            dbUser = await findDbUser({
                supabaseUserId: sbUser.id,
                email: email || null,
            });
        } catch (lookupError) {
            console.warn('auth: db lookup skipped', lookupError.message);
        }
        return {
            ...sbUser,
            id: dbUser?.id || sbUser.id,
            email: dbUser?.email || email || sbUser.email,
            auth_provider: dbUser?.auth_provider || providerFromSupabaseUser(sbUser),
            supabase_user_id: sbUser.id,
            source: 'supabase',
            linked: Boolean(dbUser),
        };
    }

    let roxclubTokenRejected = false;
    if (bearer) {
        try {
            const user = await authRoxClubJwt(bearer);
            if (user) return user;
        } catch (error) {
            console.error('auth: bearer jwt failed', error.message);
            roxclubTokenRejected = true;
        }
    }

    if (cookieToken) {
        try {
            const user = await authRoxClubJwt(cookieToken);
            if (user) return { ...user, source: 'cookie' };
        } catch (error) {
            console.error('auth: cookie failed', error.message);
            roxclubTokenRejected = true;
        }
    }

    if (roxclubTokenRejected) {
        const failure = new Error('Session expired');
        failure.status = 401;
        failure.code = 'SESSION_EXPIRED';
        throw failure;
    }

    const missing = new Error('Not authenticated');
    missing.status = 401;
    missing.code = 'UNAUTHENTICATED';
    throw missing;
}

async function authRoxClubJwt(token) {
    const payload = verifyAccessToken(token);
    const { rows } = await queryWithHardTimeout(
        `
        SELECT id, email, auth_provider, is_email_verified, supabase_user_id
        FROM users
        WHERE id = $1
        `,
        [payload.sub],
        5000
    );
    const user = rows[0];
    if (!user || !user.is_email_verified) {
        return null;
    }
    return {
        id: user.id,
        email: user.email,
        auth_provider: user.auth_provider,
        supabase_user_id: user.supabase_user_id,
        source: 'jwt',
    };
}

const authMiddleware = async (req, res, next) => {
    const startedAt = Date.now();
    let responded = false;

    const fail = (status, body) => {
        if (responded || res.headersSent) return;
        responded = true;
        return res.status(status).json(body);
    };

    const watchdog = setTimeout(() => {
        console.error('auth: watchdog fired', { ms: Date.now() - startedAt, path: req.path });
        fail(503, {
            message: 'Authentication timed out',
            detail: 'Auth did not finish within 8s',
        });
    }, 8000);

    try {
        console.log('auth: start', req.method, req.path);

        const bearer = extractBearerToken(req);
        const cookieToken = req.cookies?.[COOKIE_NAME];

        if (!bearer && !cookieToken) {
            console.warn('auth: no token', {
                hasAuthorizationHeader: Boolean(
                    req.headers.authorization || req.headers.Authorization
                ),
                path: req.path,
            });
        }

        if (bearer && isLikelySupabaseToken(bearer)) {
            console.log('auth: supabase token detected', {
                ms: Date.now() - startedAt,
                tokenLen: bearer.length,
            });
        }

        const user = await loadAuthenticatedUser(req);
        req.user = user;
        console.log('auth: ok', req.user.id, req.user.email, {
            ms: Date.now() - startedAt,
            source: user.source || 'jwt',
        });
        clearTimeout(watchdog);
        return next();
    } catch (error) {
        clearTimeout(watchdog);
        if (error.status === 401) {
            if (error.code === 'SESSION_EXPIRED') {
                return fail(401, { message: 'Session expired' });
            }
            if (error.code === 'UNAUTHORIZED' && error.message && error.message !== 'Unauthorized Access') {
                return fail(401, { message: 'Unauthorized Access', detail: error.message });
            }
            return fail(401, { message: 'Unauthorized Access' });
        }
        console.error('auth: fatal', error);
        return fail(500, { message: 'Authentication Error', detail: error.message });
    }
};

module.exports = authMiddleware;
module.exports.loadAuthenticatedUser = loadAuthenticatedUser;
module.exports.isLikelySupabaseToken = isLikelySupabaseToken;
