const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectAppleHealthAccount,
    getAppleHealthStatus,
    syncAppleHealthSamples,
    getAppleHealthSamples,
    disconnectAppleHealthAccount,
} = require('../controllers/AppleHealthConnect/AppleHealthConnect');
const {
    getAllIntegrationsStatus,
    getWorkoutsFeed,
} = require('../controllers/Integrations/IntegrationsStatus');

const AppleHealthRouter = express.Router();

// Onboarding "Connect your data" screen
AppleHealthRouter.get(
    '/api/integrations',
    authMiddleware,
    getAllIntegrationsStatus
);
AppleHealthRouter.get(
    '/api/integrations/workouts',
    authMiddleware,
    getWorkoutsFeed
);

// Apple Health (HealthKit via iOS app — no web OAuth)
AppleHealthRouter.post(
    '/api/integrations/apple-health/connect',
    authMiddleware,
    connectAppleHealthAccount
);
AppleHealthRouter.get(
    '/api/integrations/apple-health/status',
    authMiddleware,
    getAppleHealthStatus
);
AppleHealthRouter.post(
    '/api/integrations/apple-health/sync',
    authMiddleware,
    syncAppleHealthSamples
);
AppleHealthRouter.get(
    '/api/integrations/apple-health/samples',
    authMiddleware,
    getAppleHealthSamples
);
AppleHealthRouter.delete(
    '/api/integrations/apple-health',
    authMiddleware,
    disconnectAppleHealthAccount
);

module.exports = AppleHealthRouter;
