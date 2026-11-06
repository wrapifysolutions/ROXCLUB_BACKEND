const test = require('node:test');
const assert = require('node:assert/strict');

const { resolvePoolMax } = require('../lib/poolSize');

test('PG_POOL_MAX wins over clustered defaults', () => {
    assert.equal(resolvePoolMax({ PG_POOL_MAX: '8', WEB_CONCURRENCY: '2', NODE_APP_INSTANCE: '0' }), 8);
});

test('clustered default stays small enough for Neon', () => {
    assert.equal(resolvePoolMax({ WEB_CONCURRENCY: '2', NODE_APP_INSTANCE: '0' }), 8);
});

test('vercel keeps a tiny pool', () => {
    assert.equal(resolvePoolMax({ VERCEL: '1', PG_POOL_MAX: '' }), 3);
});
