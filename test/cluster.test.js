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
