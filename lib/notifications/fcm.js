let messaging = null;
let initAttempted = false;

function loadCredentials() {
    const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}

function getMessaging() {
    if (initAttempted) return messaging;
    initAttempted = true;
    const credentials = loadCredentials();
    if (!credentials) return null;
    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(credentials) });
        }
        messaging = admin.messaging();
        return messaging;
    } catch (error) {
        console.error('firebase init failed', error.message);
        messaging = null;
        return null;
    }
}

function isConfigured() {
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
        if (
            code.includes('registration-token-not-registered') ||
            code.includes('invalid-registration-token') ||
            /not registered|invalid/i.test(String(error.message || ''))
        ) {
            return { delivered: false, reason: 'INVALID_TOKEN', invalidToken: true };
        }
        console.error('fcm send failed', error.message);
        return { delivered: false, reason: 'FCM_SEND_FAILED' };
    }
}

module.exports = { getMessaging, isConfigured, sendToToken };
