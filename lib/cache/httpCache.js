const cache = require('./redis');

const AUTH_TTL_SEC = 30;

const SKIP_PREFIXES = [
    '/api/workout-sessions',
    '/api/arena/sessions',
    '/auth/',
    '/health',
    '/api/profile/export',
];

const SKIP_SUBSTRINGS = ['/connect', '/webhook'];

const GET_TTL = [
    { prefix: '/api/home', ttl: 20 },
    { prefix: '/api/train/', ttl: 30 },
    { exact: '/api/workouts', ttl: 60 },
    { prefix: '/api/workouts/', ttl: 45 },
    { prefix: '/api/categories', ttl: 120 },
    { prefix: '/api/me/saved-workouts', ttl: 20 },
    { prefix: '/api/me/workouts', ttl: 20 },
    { exact: '/api/profile', ttl: 30 },
    { exact: '/api/profile/share', ttl: 30 },
    { prefix: '/api/notifications', ttl: 10 },
    { prefix: '/api/athlete/', ttl: 30 },
    { prefix: '/api/performance/readiness', ttl: 20 },
    { prefix: '/api/readiness/checkin/today', ttl: 15 },
    { prefix: '/api/plan/', ttl: 20 },
    { prefix: '/api/programs', ttl: 60 },
    { prefix: '/api/club/', ttl: 20 },
    { exact: '/api/coaches', ttl: 30 },
    { prefix: '/api/arena', ttl: 15 },
    { exact: '/api/activities', ttl: 15 },
    { prefix: '/api/activities/', ttl: 20 },
    { prefix: '/api/coach/applications/me', ttl: 30 },
    { prefix: '/api/integrations', ttl: 20 },
];

function cacheTtlForPath(path) {
    const route = String(path || '');
    if (SKIP_PREFIXES.some((prefix) => route === prefix || route.startsWith(prefix))) return 0;
    if (SKIP_SUBSTRINGS.some((part) => route.includes(part))) return 0;
    for (const rule of GET_TTL) {
        if (rule.exact && route === rule.exact) return rule.ttl;
        if (rule.prefix && (route === rule.prefix || route.startsWith(rule.prefix))) return rule.ttl;
    }
    return 0;
}

function versionKey(userId) {
    return `u:${userId}:v`;
}

function authLookupKey({ supabaseUserId, email }) {
    return `auth:lookup:${supabaseUserId || ''}:${String(email || '').toLowerCase()}`;
}

function authIdKey(userId) {
    return `auth:id:${userId}`;
}

async function userVersion(userId) {
    if (!userId || !cache.enabled()) return 1;
    const raw = await cache.get(versionKey(userId));
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function getResponseKey(req) {
    const userId = req.user?.id || 'anon';
    const version = await userVersion(userId);
    const query = new URLSearchParams(req.query || {}).toString();
    return `http:${userId}:${version}:${req.method}:${req.path}?${query}`;
}

async function bustUserCache(user) {
    if (!user?.id || !cache.enabled()) return;
    await cache.incr(versionKey(user.id));
    await cache.del(
        authIdKey(user.id),
        user.email ? authLookupKey({ email: user.email }) : null,
        user.supabase_user_id
            ? authLookupKey({ supabaseUserId: user.supabase_user_id, email: user.email })
            : null,
        user.supabase_user_id ? authLookupKey({ supabaseUserId: user.supabase_user_id }) : null
    );
}

function invalidateOnWrite(req, res, next) {
    res.on('finish', () => {
        if (!req.user?.id) return;
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
        if (res.statusCode < 200 || res.statusCode >= 400) return;
        bustUserCache(req.user).catch(() => {});
    });
    next();
}

async function serveFromCacheOrNext(req, res, next) {
    if (req.method !== 'GET' || !cache.enabled()) return next();
    const ttl = cacheTtlForPath(req.path);
    if (!ttl) return next();

    try {
        const key = await getResponseKey(req);
        const hit = await cache.getJson(key);
        if (hit && hit.body !== undefined) {
            res.setHeader('X-Cache', 'HIT');
            return res.status(hit.status || 200).json(hit.body);
        }

        const originalJson = res.json.bind(res);
        let stored = false;
        res.json = (body) => {
            res.json = originalJson;
            const status = res.statusCode || 200;
            if (!stored && status === 200) {
                stored = true;
                cache.setJson(key, { status, body }, ttl).catch(() => {});
            }
            res.setHeader('X-Cache', 'MISS');
            return originalJson(body);
        };
    } catch (_) {
        // Cache must never change handler behavior.
    }
    return next();
}

async function cachedLookup(key, ttlSec, loader) {
    if (!cache.enabled()) return loader();
    const hit = await cache.getJson(key);
    if (hit !== undefined) return hit;
    const value = await loader();
    cache.setJson(key, value, ttlSec).catch(() => {});
    return value;
}

module.exports = {
    AUTH_TTL_SEC,
    cacheTtlForPath,
    authLookupKey,
    authIdKey,
    bustUserCache,
    invalidateOnWrite,
    serveFromCacheOrNext,
    cachedLookup,
};
