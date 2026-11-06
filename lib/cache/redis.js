const MEMORY_CAP = 4000;
const memory = new Map();

let redis = null;
let redisFailed = false;

function isTestRuntime() {
    return (
        process.env.NODE_ENV === 'test' ||
        process.env.CACHE_DISABLED === 'true' ||
        Boolean(process.env.NODE_TEST_CONTEXT)
    );
}

function enabled() {
    if (isTestRuntime()) return process.env.CACHE_DRIVER === 'memory';
    if (process.env.CACHE_DISABLED === 'true') return false;
    if (process.env.REDIS_URL) return true;
    if (process.env.CACHE_DRIVER === 'memory') return true;
    return process.env.ROXCLUB_ENV === 'production' || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

function driver() {
    if (!enabled()) return 'off';
    if (redis && !redisFailed) return 'redis';
    return 'memory';
}

function memoryGet(key) {
    const row = memory.get(key);
    if (!row) return null;
    if (row.exp && row.exp < Date.now()) {
        memory.delete(key);
        return null;
    }
    return row.val;
}

function memorySet(key, val, ttlSec) {
    if (memory.size >= MEMORY_CAP) {
        const first = memory.keys().next().value;
        if (first) memory.delete(first);
    }
    memory.set(key, {
        val,
        exp: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
    });
}

async function connect() {
    const url = String(process.env.REDIS_URL || '').trim();
    if (!url || isTestRuntime()) return { driver: driver() };
    if (redis) return { driver: 'redis' };
    try {
        const Redis = require('ioredis');
        redis = new Redis(url, {
            maxRetriesPerRequest: 1,
            enableReadyCheck: true,
            lazyConnect: true,
            connectTimeout: 1500,
            commandTimeout: 800,
            retryStrategy(times) {
                if (times > 8) return null;
                return Math.min(times * 200, 2000);
            },
        });
        redis.on('error', (error) => {
            redisFailed = true;
            console.warn('redis: error', error.message);
        });
        redis.on('ready', () => {
            redisFailed = false;
        });
        await redis.connect();
        redisFailed = false;
        return { driver: 'redis' };
    } catch (error) {
        redisFailed = true;
        console.warn('redis: using memory fallback', error.message);
        return { driver: 'memory' };
    }
}

async function quit() {
    if (!redis) return;
    try {
        await redis.quit();
    } catch (_) {
        try {
            redis.disconnect();
        } catch (_) {}
    }
    redis = null;
}

async function ping() {
    const started = Date.now();
    if (!enabled()) return { ok: true, driver: 'off', ms: 0 };
    if (redis && !redisFailed) {
        try {
            const pong = await redis.ping();
            return { ok: pong === 'PONG', driver: 'redis', ms: Date.now() - started };
        } catch (error) {
            redisFailed = true;
            return { ok: false, driver: 'memory', error: error.message, ms: Date.now() - started };
        }
    }
    return { ok: true, driver: 'memory', ms: Date.now() - started };
}

async function get(key) {
    if (!enabled()) return null;
    if (redis && !redisFailed) {
        try {
            return await redis.get(key);
        } catch (error) {
            redisFailed = true;
            console.warn('redis: get fallback', error.message);
        }
    }
    return memoryGet(key);
}

async function set(key, value, ttlSec) {
    if (!enabled()) return;
    const text = String(value);
    if (redis && !redisFailed) {
        try {
            if (ttlSec > 0) await redis.set(key, text, 'EX', ttlSec);
            else await redis.set(key, text);
            return;
        } catch (error) {
            redisFailed = true;
            console.warn('redis: set fallback', error.message);
        }
    }
    memorySet(key, text, ttlSec);
}

async function del(...keys) {
    const list = keys.filter(Boolean);
    if (!enabled() || list.length === 0) return;
    if (redis && !redisFailed) {
        try {
            await redis.del(...list);
            return;
        } catch (error) {
            redisFailed = true;
            console.warn('redis: del fallback', error.message);
        }
    }
    for (const key of list) memory.delete(key);
}

async function setNx(key, value, ttlSec) {
    if (!enabled()) return false;
    const text = String(value);
    if (redis && !redisFailed) {
        try {
            const result =
                ttlSec > 0
                    ? await redis.set(key, text, 'EX', ttlSec, 'NX')
                    : await redis.set(key, text, 'NX');
            return result === 'OK';
        } catch (error) {
            redisFailed = true;
            console.warn('redis: setNx fallback', error.message);
        }
    }
    if (memoryGet(key) != null) return false;
    memorySet(key, text, ttlSec);
    return true;
}

async function incr(key, ttlSec = 86400) {
    if (!enabled()) return 1;
    if (redis && !redisFailed) {
        try {
            const value = await redis.incr(key);
            if (value === 1 && ttlSec > 0) await redis.expire(key, ttlSec);
            return value;
        } catch (error) {
            redisFailed = true;
            console.warn('redis: incr fallback', error.message);
        }
    }
    const next = Number(memoryGet(key) || 0) + 1;
    memorySet(key, String(next), ttlSec);
    return next;
}

async function getJson(key) {
    const raw = await get(key);
    if (raw == null) return undefined;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return undefined;
    }
}

async function setJson(key, value, ttlSec) {
    await set(key, JSON.stringify(value), ttlSec);
}

function resetMemoryForTests() {
    memory.clear();
    redisFailed = false;
}

module.exports = {
    enabled,
    driver,
    connect,
    quit,
    ping,
    get,
    set,
    setNx,
    del,
    incr,
    getJson,
    setJson,
    resetMemoryForTests,
};
