const test = require('node:test');
const assert = require('node:assert/strict');

test('primary worker is instance 0', () => {
    const previous = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '0';
    delete require.cache[require.resolve('../lib/cluster')];
    const cluster = require('../lib/cluster');
    assert.equal(cluster.workerId(), '0');
    assert.equal(cluster.isPrimaryWorker(), true);
    if (previous == null) delete process.env.NODE_APP_INSTANCE;
    else process.env.NODE_APP_INSTANCE = previous;
    delete require.cache[require.resolve('../lib/cluster')];
});

test('missed job skips when another replica already holds the lock', async () => {
    process.env.CACHE_DRIVER = 'memory';
    delete process.env.CACHE_DISABLED;
    delete require.cache[require.resolve('../lib/cache/redis')];
    delete require.cache[require.resolve('../lib/plan/missedJob')];
    const cache = require('../lib/cache/redis');
    cache.resetMemoryForTests();
    const missed = require('../lib/plan/missedJob');
    const first = await missed.runMissedSessionJobIfLeader(new Date(), async () => ({ rows: [] }));
    const second = await missed.runMissedSessionJobIfLeader(new Date(), async () => ({ rows: [] }));
    assert.equal(first.skipped, undefined);
    assert.equal(second.skipped, true);
});

test('non-primary workers skip singleton jobs', () => {
    const previous = process.env.NODE_APP_INSTANCE;
    process.env.NODE_APP_INSTANCE = '1';
    delete require.cache[require.resolve('../lib/cluster')];
    const cluster = require('../lib/cluster');
    assert.equal(cluster.workerId(), '1');
    assert.equal(cluster.isPrimaryWorker(), false);
    assert.equal(cluster.isClustered(), true);
    if (previous == null) delete process.env.NODE_APP_INSTANCE;
    else process.env.NODE_APP_INSTANCE = previous;
    delete require.cache[require.resolve('../lib/cluster')];
});
