const { garminConfig } = require('../../lib/garmin/garminConfig');
const { handleGarminWebhook } = require('../../lib/garmin/garminWebhookStore');

function verifyGarminWebhook(req) {
    const expectedSecret = garminConfig.webhookSecret;
    if (expectedSecret) {
        const provided =
            req.headers['x-garmin-webhook-secret'] ||
            req.query?.secret;
        if (provided !== expectedSecret) return false;
    }
    if (garminConfig.clientId) {
        const clientId = req.headers['garmin-client-id'];
        if (clientId && clientId !== garminConfig.clientId) return false;
    }
    return true;
}

function webhookPing(req, res) {
    return res.status(200).json({
        ok: true,
        service: 'roxclub-garmin-webhook',
        path: req.path,
    });
}

async function handle(eventType, req, res) {
    try {
        if (!verifyGarminWebhook(req)) {
            return res.status(401).json({ ok: false, message: 'Invalid Garmin webhook credentials' });
        }
        const result = await handleGarminWebhook(eventType, req.body || {});
        return res.status(200).json({
            ok: true,
            received: true,
            event_type: eventType,
            user_linked: Boolean(result.userId),
            samples_saved: result.samplesSaved,
            deregistered: result.deregistered,
        });
    } catch (error) {
        console.error(`Garmin ${eventType} webhook error`, error.message);
        return res.status(200).json({
            ok: false,
            received: true,
            event_type: eventType,
            message: 'Stored with error',
            detail: error.message,
        });
    }
}

const garminActivityWebhook = (req, res) => handle('activity', req, res);
const garminSleepWebhook = (req, res) => handle('sleep', req, res);
const garminHrvWebhook = (req, res) => handle('hrv', req, res);
const garminDailiesWebhook = (req, res) => handle('dailies', req, res);
const garminDeregisterWebhook = (req, res) => handle('deregistrations', req, res);

module.exports = {
    webhookPing,
    garminActivityWebhook,
    garminSleepWebhook,
    garminHrvWebhook,
    garminDailiesWebhook,
    garminDeregisterWebhook,
};
