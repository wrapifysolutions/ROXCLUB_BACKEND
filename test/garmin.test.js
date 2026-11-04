const test = require('node:test');
const assert = require('node:assert/strict');
const { getGarminAvailability } = require('../lib/garmin/garminConfig');
const { generatePkce } = require('../lib/garmin/garminClient');
const {
    extractGarminUserId,
    normalizeGarminRecord,
    flattenGarmin,
} = require('../lib/garmin/garminDataStore');
const { connectGarmin, getGarminStatus } = require('../controllers/GarminConnect/GarminConnect');
const { recordGarminSamples } = require('../lib/readiness/dailyWellness');

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

test('Garmin is unavailable until official developer keys are set', () => {
    const availability = getGarminAvailability({
        GARMIN_CLIENT_ID: '',
        GARMIN_CLIENT_SECRET: '',
        TOKEN_ENCRYPTION_KEY: 'test-key',
    });
    assert.equal(availability.ready, false);
    assert.ok(availability.missing.includes('GARMIN_CLIENT_ID'));
});

test('Garmin PKCE verifier is URL-safe and long enough', () => {
    const pkce = generatePkce();
    assert.match(pkce.codeVerifier, /^[A-Za-z0-9_-]{43,}$/);
    assert.match(pkce.codeChallenge, /^[A-Za-z0-9_-]{43,}$/);
    assert.notEqual(pkce.codeVerifier, pkce.codeChallenge);
});

test('Garmin webhook payload maps official activity fields only', () => {
    const payload = {
        activities: [
            {
                userId: 'g-user-1',
                summaryId: 'act-9',
                activityName: 'Run',
                activityType: 'RUNNING',
                startTimeInSeconds: 1730700000,
                durationInSeconds: 1800,
                distanceInMeters: 5000,
                averageHeartRateInBeatsPerMinute: 148,
                activeKilocalories: 320,
            },
        ],
    };
    assert.equal(extractGarminUserId(payload), 'g-user-1');
    const record = flattenGarmin(payload, ['activities'])[0];
    const sample = normalizeGarminRecord('activity', record, 'g-user-1');
    assert.equal(sample.external_id, 'act-9');
    assert.equal(sample.duration_seconds, 1800);
    assert.equal(sample.distance, 5000);
    assert.equal(sample.average_heartrate, 148);
});

test('Garmin connect and status require auth', async () => {
    const res = resStub();
    await connectGarmin({ user: null }, res);
    assert.ok(res.statusCode === 401 || res.statusCode === 503);
    await getGarminStatus({ user: null }, res);
    assert.equal(res.statusCode, 401);
});

test('Garmin sleep samples roll into daily wellness', async () => {
    const writes = [];
    const query = async (sql, params) => {
        if (sql.includes('SELECT timezone')) return { rows: [{ timezone: 'UTC' }] };
        if (sql.includes('readiness:upsert_wellness')) {
            writes.push({ source: params[2], sleep: params[3] });
            return { rows: [] };
        }
        throw new Error(sql);
    };
    const saved = await recordGarminSamples(
        'user-1',
        [
            {
                sample_type: 'sleep',
                duration_seconds: 25200,
                start_at: '2026-11-04T00:00:00Z',
            },
        ],
        query
    );
    assert.equal(saved, 1);
    assert.equal(writes[0].source, 'garmin');
    assert.equal(writes[0].sleep, 420);
});
