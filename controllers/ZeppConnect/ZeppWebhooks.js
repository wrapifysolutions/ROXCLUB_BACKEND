const { saveZeppWebhookEvent } = require('../../lib/zepp/zeppWebhookStore');

function verifyWebhookSecret(req) {
    const expected = process.env.ZEPP_WEBHOOK_SECRET;
    if (!expected) {
        return true;
    }

    const provided =
        req.headers['x-zepp-webhook-secret'] ||
        req.headers['x-webhook-secret'] ||
        req.query?.secret;

    return typeof provided === 'string' && provided === expected;
}

async function handleZeppWebhook(eventType, req, res) {
    try {
        if (!verifyWebhookSecret(req)) {
            return res.status(401).json({
                ok: false,
                message: 'Invalid webhook secret',
            });
        }

        const payload = req.body ?? {};
        const saved = await saveZeppWebhookEvent(eventType, payload);

        return res.status(200).json({
            ok: true,
            received: true,
            event_type: eventType,
            id: saved.id,
            user_linked: Boolean(saved.user_id),
            samples_saved: saved.samples_saved || 0,
        });
    } catch (error) {
        console.error(`Zepp ${eventType} webhook error`, error.message);
        // Return 200 so Zepp does not disable callback after retries (log + store failure separately).
        return res.status(200).json({
            ok: false,
            received: true,
            event_type: eventType,
            message: 'Stored with error',
            detail: error.message,
        });
    }
}

/** Partner console URL verification (some consoles probe with GET). */
function webhookPing(req, res) {
    return res.status(200).json({
        ok: true,
        service: 'roxclub-zepp-webhook',
        path: req.path,
    });
}

const zeppActivityWebhook = (req, res) => handleZeppWebhook('activity', req, res);
const zeppHrvWebhook = (req, res) => handleZeppWebhook('hrv', req, res);
const zeppSleepWebhook = (req, res) => handleZeppWebhook('sleep', req, res);

module.exports = {
    webhookPing,
    zeppActivityWebhook,
    zeppHrvWebhook,
    zeppSleepWebhook,
};
