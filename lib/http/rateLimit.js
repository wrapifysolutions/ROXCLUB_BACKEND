const cache = require('../cache/redis');

function envInt(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clientKey(req) {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return req.user?.id || req.ip || forwarded || 'anon';
}

function isSkippedPath(req) {
    if (req.method === 'OPTIONS' || req.method === 'HEAD') return true;
    const path = String(req.path || req.url || '').split('?')[0];
    if (path === '/' || path === '/health') return true;
    if (path.includes('/webhook')) return true;
    return false;
}

function sendLimited(res, windowMs) {
    const retryAfter = Math.max(1, Math.ceil(windowMs / 1000));
    if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(retryAfter));
    }
    return res.status(429).json({
        error: 'RATE_LIMITED',
        message: 'Too many requests. Try again shortly.',
    });
}

function memoryHit(hits, key, windowMs, max) {
    const now = Date.now();
    const bucket = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (bucket.length >= max) {
        hits.set(key, bucket);
        return true;
    }
    bucket.push(now);
    hits.set(key, bucket);
    return false;
}

function createRateLimit({ windowMs = 60000, max = 60, name = 'api', skip } = {}) {
    const hits = new Map();
    return function rateLimit(req, res, next) {
        if (process.env.NODE_ENV === 'test') return next();
        if (process.env.RATE_LIMIT_DISABLED === 'true') return next();
        if (isSkippedPath(req) || skip?.(req)) return next();

        const key = `${name}:${clientKey(req)}`;
        const useRedis = cache.enabled() && cache.driver() === 'redis';
        if (!useRedis) {
            if (memoryHit(hits, key, windowMs, max)) return sendLimited(res, windowMs);
            return next();
        }

        const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
        cache
            .incr(`rl:${key}`, ttlSec)
            .then((count) => {
                if (count > max) return sendLimited(res, windowMs);
                return next();
            })
            .catch(() => {
                if (memoryHit(hits, key, windowMs, max)) return sendLimited(res, windowMs);
                return next();
            });
    };
}

const windowMs = envInt('RATE_LIMIT_WINDOW_MS', 60000);
const authLimit = createRateLimit({
    windowMs,
    max: envInt('RATE_LIMIT_AUTH_MAX', 20),
    name: 'auth',
});
const writeLimit = createRateLimit({
    windowMs,
    max: envInt('RATE_LIMIT_WRITE_MAX', 90),
    name: 'write',
});
const readLimit = createRateLimit({
    windowMs,
    max: envInt('RATE_LIMIT_READ_MAX', 240),
    name: 'read',
});

function globalRateLimit(req, res, next) {
    if (process.env.NODE_TEST_CONTEXT && process.env.RATE_LIMIT_IN_TESTS !== 'true') {
        return next();
    }
    const path = String(req.path || req.url || '').split('?')[0];
    if (path.startsWith('/auth/')) return authLimit(req, res, next);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return writeLimit(req, res, next);
    return readLimit(req, res, next);
}

module.exports = { createRateLimit, globalRateLimit, isSkippedPath };
