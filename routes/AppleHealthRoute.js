const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectAppleHealthAccount,
    getAppleHealthStatus,
    syncAppleHealthSamples,
    disconnectAppleHealthAccount,
} = require('../controllers/AppleHealthConnect/AppleHealthConnect');
const { getAllIntegrationsStatus } = require('../controllers/Integrations/IntegrationsStatus');

const AppleHealthRouter = express.Router();

// Onboarding "Connect your data" screen
AppleHealthRouter.get(
    '/api/integrations',
    authMiddleware,
    getAllIntegrationsStatus
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
AppleHealthRouter.delete(
    '/api/integrations/apple-health',
    authMiddleware,
    disconnectAppleHealthAccount
);

module.exports = AppleHealthRouter;
