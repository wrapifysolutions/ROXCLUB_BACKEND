const test = require('node:test');
const assert = require('node:assert/strict');

process.env.CACHE_DRIVER = 'memory';
delete process.env.CACHE_DISABLED;

const cache = require('../lib/cache/redis');
const {
    cacheTtlForPath,
    serveFromCacheOrNext,
    bustUserCache,
} = require('../lib/cache/httpCache');

function mockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) {
            this.headers[name] = value;
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
}

test.beforeEach(() => {
    cache.resetMemoryForTests();
});

test('hot GET paths are cached and live session paths are not', () => {
    assert.ok(cacheTtlForPath('/api/home') > 0);
    assert.ok(cacheTtlForPath('/api/train/overview') > 0);
    assert.ok(cacheTtlForPath('/api/workouts') > 0);
    assert.ok(cacheTtlForPath('/api/profile') > 0);
    assert.equal(cacheTtlForPath('/api/workout-sessions/active'), 0);
    assert.equal(cacheTtlForPath('/api/arena/sessions/abc'), 0);
    assert.equal(cacheTtlForPath('/api/integrations/strava/connect'), 0);
    assert.equal(cacheTtlForPath('/auth/me'), 0);
    assert.equal(cacheTtlForPath('/api/profile/export'), 0);
});

test('setNx only the first caller wins', async () => {
    assert.equal(await cache.setNx('lock', 'a', 60), true);
    assert.equal(await cache.setNx('lock', 'b', 60), false);
    assert.equal(await cache.get('lock'), 'a');
});

test('memory cache round-trips JSON', async () => {
    assert.equal(cache.enabled(), true);
    await cache.setJson('k', { ok: true }, 60);
    assert.deepEqual(await cache.getJson('k'), { ok: true });
    await cache.del('k');
    assert.equal(await cache.getJson('k'), undefined);
});

test('GET cache returns the same body on the second call', async () => {
    const user = { id: 'user-1', email: 'a@example.com' };
    let handlerCalls = 0;

    async function run() {
        const req = { method: 'GET', path: '/api/home', query: {}, user };
        const res = mockRes();
        await serveFromCacheOrNext(req, res, () => {
            handlerCalls += 1;
            res.json({ home: true, n: handlerCalls });
        });
        return res;
    }

    const first = await run();
    const second = await run();
    assert.equal(first.headers['X-Cache'], 'MISS');
    assert.equal(second.headers['X-Cache'], 'HIT');
    assert.equal(handlerCalls, 1);
    assert.deepEqual(first.body, second.body);
});

test('a successful write busts later GET cache', async () => {
    const user = { id: 'user-2', email: 'b@example.com' };
    let xp = 10;

    async function getProfile() {
        const req = { method: 'GET', path: '/api/profile', query: {}, user };
        const res = mockRes();
        await serveFromCacheOrNext(req, res, () => {
            res.json({ xp });
        });
        return res;
    }

    await getProfile();
    xp = 99;
    const cached = await getProfile();
    assert.equal(cached.headers['X-Cache'], 'HIT');
    assert.equal(cached.body.xp, 10);

    await bustUserCache(user);
    const fresh = await getProfile();
    assert.equal(fresh.headers['X-Cache'], 'MISS');
    assert.equal(fresh.body.xp, 99);
});

test('bustUserCache increments the user version', async () => {
    await bustUserCache({ id: 'missing' });
    assert.equal(await cache.get('u:missing:v'), '1');
});
