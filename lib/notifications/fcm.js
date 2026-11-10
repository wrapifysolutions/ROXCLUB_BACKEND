let messaging = null;
let initAttempted = false;

function isTestRuntime() {
    return (
        process.env.NODE_ENV === 'test' ||
        Boolean(process.env.NODE_TEST_CONTEXT)
    );
}

function unwrapEnvJson(raw) {
    let text = String(raw || '').trim();
    if (!text) return '';
    if (
        (text.startsWith("'") && text.endsWith("'")) ||
        (text.startsWith('"') && text.endsWith('"'))
    ) {
        text = text.slice(1, -1).trim();
    }
    return text;
}

function loadCredentials() {
    const raw = unwrapEnvJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (parsed.private_key) {
            parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
        }
        const projectId = String(
            process.env.FIREBASE_PROJECT_ID || parsed.project_id || ''
        ).trim();
        if (projectId) parsed.project_id = projectId;
        if (
            parsed.type !== 'service_account' ||
            !parsed.project_id ||
            !parsed.client_email ||
            !parsed.private_key
        ) {
            return null;
        }
        return parsed;
    } catch (_) {
        return null;
    }
}

function getMessaging() {
    if (initAttempted) return messaging;
    initAttempted = true;
    if (isTestRuntime() && process.env.FCM_IN_TESTS !== 'true') {
        messaging = null;
        return null;
    }
    const credentials = loadCredentials();
    if (!credentials) return null;
    try {
        const { initializeApp, getApps, cert } = require('firebase-admin/app');
        const { getMessaging } = require('firebase-admin/messaging');
        if (getApps().length === 0) {
            initializeApp({
                credential: cert(credentials),
                projectId: credentials.project_id,
            });
        }
        messaging = getMessaging();
        return messaging;
    } catch (error) {
        console.error('firebase init failed', error.message);
        messaging = null;
        return null;
    }
}

function isConfigured() {
    if (isTestRuntime() && process.env.FCM_IN_TESTS !== 'true') return false;
    return Boolean(loadCredentials());
}

async function sendToToken(token, payload) {
    const client = getMessaging();
    if (!client) {
        return { delivered: false, reason: 'NO_NOTIFICATION_PROVIDER' };
    }
    const data = {};
    const source = payload.data && typeof payload.data === 'object' ? payload.data : {};
    for (const [key, value] of Object.entries(source)) {
        if (value == null) continue;
        data[String(key)] = String(value);
    }
    try {
        await client.send({
            token,
            notification: {
                title: payload.title,
                body: payload.body,
            },
            data,
            android: { priority: 'high' },
            apns: { payload: { aps: { sound: 'default' } } },
        });
        return { delivered: true, reason: null };
    } catch (error) {
        const code = String(error.code || error.errorInfo?.code || '');
        const message = String(error.message || '');
        if (
            code.includes('registration-token-not-registered') ||
            code.includes('invalid-registration-token') ||
            code.includes('invalid-argument') ||
            /not registered|not a valid fcm|invalid.argument/i.test(message)
        ) {
            return { delivered: false, reason: 'INVALID_TOKEN', invalidToken: true };
        }
        console.error('fcm send failed', error.message);
        return { delivered: false, reason: 'FCM_SEND_FAILED' };
    }
}

function resetForTests() {
    messaging = null;
    initAttempted = false;
}

module.exports = {
    getMessaging,
    isConfigured,
    sendToToken,
    loadCredentials,
    resetForTests,
};
