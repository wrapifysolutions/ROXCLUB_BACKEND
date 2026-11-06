const test = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimit, globalRateLimit, isSkippedPath } = require('../lib/http/rateLimit');

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

test('health, root, OPTIONS, and webhooks are not rate limited', () => {
    assert.equal(isSkippedPath({ method: 'GET', path: '/health' }), true);
    assert.equal(isSkippedPath({ method: 'GET', path: '/' }), true);
    assert.equal(isSkippedPath({ method: 'OPTIONS', path: '/api/home' }), true);
    assert.equal(
        isSkippedPath({ method: 'POST', path: '/api/integrations/garmin/webhook/activities' }),
        true
    );
    assert.equal(isSkippedPath({ method: 'GET', path: '/api/home' }), false);
});

test('per-route limiter still isolates users and returns 429', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
        const limit = createRateLimit({ windowMs: 60000, max: 1, name: 't' });
        const res = mockRes();
        let nexts = 0;
        limit({ method: 'GET', path: '/api/home', user: { id: 'a' }, ip: '1' }, res, () => {
            nexts += 1;
        });
        limit({ method: 'GET', path: '/api/home', user: { id: 'a' }, ip: '1' }, res, () => {
            nexts += 1;
        });
        assert.equal(nexts, 1);
        assert.equal(res.statusCode, 429);
        assert.equal(res.body.error, 'RATE_LIMITED');
        const other = mockRes();
        limit({ method: 'GET', path: '/api/home', user: { id: 'b' }, ip: '2' }, other, () => {
            nexts += 1;
        });
        assert.equal(nexts, 2);
    } finally {
        process.env.NODE_ENV = previous;
    }
});

test('global limiter skips health even when tests opt in', () => {
    const previous = process.env.NODE_ENV;
    const previousFlag = process.env.RATE_LIMIT_IN_TESTS;
    process.env.NODE_ENV = 'production';
    process.env.RATE_LIMIT_IN_TESTS = 'true';
    try {
        const res = mockRes();
        let nexts = 0;
        globalRateLimit({ method: 'GET', path: '/health', ip: '9.9.9.9' }, res, () => {
            nexts += 1;
        });
        globalRateLimit({ method: 'GET', path: '/health', ip: '9.9.9.9' }, res, () => {
            nexts += 1;
        });
        assert.equal(nexts, 2);
        assert.equal(res.statusCode, 200);
    } finally {
        process.env.NODE_ENV = previous;
        process.env.RATE_LIMIT_IN_TESTS = previousFlag;
    }
});
