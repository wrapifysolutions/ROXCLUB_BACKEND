const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectGarmin,
    garminCallback,
    getGarminStatus,
    disconnectGarminAccount,
} = require('../controllers/GarminConnect/GarminConnect');
const {
    webhookPing,
    garminActivityWebhook,
    garminSleepWebhook,
    garminHrvWebhook,
    garminDailiesWebhook,
    garminDeregisterWebhook,
} = require('../controllers/GarminConnect/GarminWebhooks');

const GarminRouter = express.Router();

GarminRouter.get('/api/integrations/garmin/connect', authMiddleware, connectGarmin);
GarminRouter.get('/api/integrations/garmin/callback', garminCallback);
GarminRouter.get('/api/integrations/garmin/status', authMiddleware, getGarminStatus);
GarminRouter.delete('/api/integrations/garmin', authMiddleware, disconnectGarminAccount);

GarminRouter.get('/api/integrations/garmin/webhook/activities', webhookPing);
GarminRouter.post('/api/integrations/garmin/webhook/activities', garminActivityWebhook);
GarminRouter.get('/api/integrations/garmin/webhook/sleeps', webhookPing);
GarminRouter.post('/api/integrations/garmin/webhook/sleeps', garminSleepWebhook);
GarminRouter.get('/api/integrations/garmin/webhook/hrv', webhookPing);
GarminRouter.post('/api/integrations/garmin/webhook/hrv', garminHrvWebhook);
GarminRouter.get('/api/integrations/garmin/webhook/dailies', webhookPing);
GarminRouter.post('/api/integrations/garmin/webhook/dailies', garminDailiesWebhook);
GarminRouter.get('/api/integrations/garmin/webhook/deregistrations', webhookPing);
GarminRouter.post('/api/integrations/garmin/webhook/deregistrations', garminDeregisterWebhook);

module.exports = GarminRouter;
