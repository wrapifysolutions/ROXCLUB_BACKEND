const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectZepp,
    zeppCallback,
    getZeppStatus,
    disconnectZeppAccount,
    getZeppData,
} = require('../controllers/ZeppConnect/ZeppConnect');
const {
    webhookPing,
    zeppActivityWebhook,
    zeppHrvWebhook,
    zeppSleepWebhook,
} = require('../controllers/ZeppConnect/ZeppWebhooks');

const ZeppRouter = express.Router();

ZeppRouter.get('/api/integrations/zepp/connect', authMiddleware, connectZepp);
ZeppRouter.get('/api/integrations/zepp/callback', zeppCallback);
ZeppRouter.get('/api/integrations/zepp/status', authMiddleware, getZeppStatus);
ZeppRouter.get('/api/integrations/zepp/data', authMiddleware, getZeppData);
ZeppRouter.delete('/api/integrations/zepp', authMiddleware, disconnectZeppAccount);

// Zepp partner data callbacks (register in Huami/Zepp console)
ZeppRouter.get('/api/integrations/zepp/activity/webhook', webhookPing);
ZeppRouter.post('/api/integrations/zepp/activity/webhook', zeppActivityWebhook);
ZeppRouter.get('/api/integrations/zepp/hrv/webhook', webhookPing);
ZeppRouter.post('/api/integrations/zepp/hrv/webhook', zeppHrvWebhook);
ZeppRouter.get('/api/integrations/zepp/sleep/webhook', webhookPing);
ZeppRouter.post('/api/integrations/zepp/sleep/webhook', zeppSleepWebhook);

module.exports = ZeppRouter;
