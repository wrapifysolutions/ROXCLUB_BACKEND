const test = require('node:test');
const assert = require('node:assert/strict');
const {
    connectSamsungHealthAccount,
    getSamsungHealthStatus,
    syncSamsungHealthSamples,
} = require('../controllers/SamsungHealthConnect/SamsungHealthConnect');
const { recordSamsungSamples } = require('../lib/readiness/dailyWellness');

function resStub() {
    return {
        statusCode: 200,
        body: null,
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

test('Samsung Health routes require auth', async () => {
    const res = resStub();
    await connectSamsungHealthAccount({ user: null, body: {} }, res);
    assert.equal(res.statusCode, 401);
    await getSamsungHealthStatus({ user: null }, res);
    assert.equal(res.statusCode, 401);
    await syncSamsungHealthSamples({ user: null, body: {} }, res);
    assert.equal(res.statusCode, 401);
});

test('Samsung Health samples roll into daily wellness as samsung_health', async () => {
    const writes = [];
    const query = async (sql, params) => {
        if (sql.includes('SELECT timezone')) return { rows: [{ timezone: 'Asia/Karachi' }] };
        if (sql.includes('readiness:upsert_wellness')) {
            writes.push({ source: params[2], hrv: params[5], date: params[1] });
            return { rows: [] };
        }
        throw new Error(sql);
    };

    const saved = await recordSamsungSamples(
        'user-1',
        [{ sample_type: 'hrv', value: 58, start_at: '2026-11-04T04:00:00Z' }],
        query
    );

    assert.equal(saved, 1);
    assert.equal(writes[0].source, 'samsung_health');
    assert.equal(writes[0].hrv, 58);
});
