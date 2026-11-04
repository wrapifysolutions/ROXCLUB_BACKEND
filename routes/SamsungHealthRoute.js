const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectSamsungHealthAccount,
    getSamsungHealthStatus,
    syncSamsungHealthSamples,
    getSamsungHealthSamples,
    disconnectSamsungHealthAccount,
} = require('../controllers/SamsungHealthConnect/SamsungHealthConnect');

const SamsungHealthRouter = express.Router();

SamsungHealthRouter.post(
    '/api/integrations/samsung-health/connect',
    authMiddleware,
    connectSamsungHealthAccount
);
SamsungHealthRouter.get(
    '/api/integrations/samsung-health/status',
    authMiddleware,
    getSamsungHealthStatus
);
SamsungHealthRouter.post(
    '/api/integrations/samsung-health/sync',
    authMiddleware,
    syncSamsungHealthSamples
);
SamsungHealthRouter.get(
    '/api/integrations/samsung-health/samples',
    authMiddleware,
    getSamsungHealthSamples
);
SamsungHealthRouter.delete(
    '/api/integrations/samsung-health',
    authMiddleware,
    disconnectSamsungHealthAccount
);

module.exports = SamsungHealthRouter;
