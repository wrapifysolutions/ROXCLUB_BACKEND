const test = require('node:test');
const assert = require('node:assert/strict');

test('service account JSON yields project id and required fields', () => {
    const previousJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const previousProject = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        type: 'service_account',
        project_id: 'roxclub-test',
        private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
        client_email: 'firebase-adminsdk@roxclub-test.iam.gserviceaccount.com',
    });
    delete process.env.FIREBASE_PROJECT_ID;
    delete require.cache[require.resolve('../lib/notifications/fcm')];
    const fcm = require('../lib/notifications/fcm');
    const credentials = fcm.loadCredentials();
    assert.equal(credentials.project_id, 'roxclub-test');
    assert.equal(credentials.client_email.includes('roxclub-test'), true);
    assert.match(credentials.private_key, /BEGIN PRIVATE KEY/);
    assert.match(credentials.private_key, /\n/);
    if (previousJson == null) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousJson;
    if (previousProject == null) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previousProject;
    delete require.cache[require.resolve('../lib/notifications/fcm')];
});

test('FIREBASE_PROJECT_ID overrides json project_id', () => {
    const previousJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    const previousProject = process.env.FIREBASE_PROJECT_ID;
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
        type: 'service_account',
        project_id: 'from-json',
        private_key: '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n',
        client_email: 'firebase-adminsdk@from-json.iam.gserviceaccount.com',
    });
    process.env.FIREBASE_PROJECT_ID = 'from-env';
    delete require.cache[require.resolve('../lib/notifications/fcm')];
    const fcm = require('../lib/notifications/fcm');
    assert.equal(fcm.loadCredentials().project_id, 'from-env');
    if (previousJson == null) delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON = previousJson;
    if (previousProject == null) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = previousProject;
    delete require.cache[require.resolve('../lib/notifications/fcm')];
});
