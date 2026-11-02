function createRateLimit({ windowMs = 60000, max = 60, name = 'api' } = {}) {
    const hits = new Map();
    return function rateLimit(req, res, next) {
        if (process.env.NODE_ENV === 'test') return next();
        const key = `${name}:${req.user?.id || req.ip || 'anon'}`;
        const now = Date.now();
        const bucket = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
        if (bucket.length >= max) {
            return res.status(429).json({
                error: 'RATE_LIMITED',
                message: 'Too many requests. Try again shortly.',
            });
        }
        bucket.push(now);
        hits.set(key, bucket);
        return next();
    };
}

module.exports = { createRateLimit };
