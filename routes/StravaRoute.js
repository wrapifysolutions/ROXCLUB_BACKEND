const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectStrava,
    stravaCallback,
    getStravaStatus,
    disconnectStravaAccount,
    syncStravaAccount,
    getStravaAthlete,
    getStravaActivities,
} = require('../controllers/StarvaConnect/StarvaConnect');

const StravaRouter = express.Router();

StravaRouter.get('/api/integrations/strava/connect', authMiddleware, connectStrava);
StravaRouter.get('/api/integrations/strava/callback', stravaCallback);
StravaRouter.get('/api/integrations/strava/status', authMiddleware, getStravaStatus);
StravaRouter.post('/api/integrations/strava/sync', authMiddleware, syncStravaAccount);
StravaRouter.get('/api/integrations/strava/athlete', authMiddleware, getStravaAthlete);
StravaRouter.get('/api/integrations/strava/activities', authMiddleware, getStravaActivities);
StravaRouter.delete('/api/integrations/strava', authMiddleware, disconnectStravaAccount);

module.exports = StravaRouter;
