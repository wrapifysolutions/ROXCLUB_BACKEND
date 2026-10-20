const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    connectZepp,
    zeppCallback,
    getZeppStatus,
    disconnectZeppAccount,
} = require('../controllers/ZeppConnect/ZeppConnect');

const ZeppRouter = express.Router();

ZeppRouter.get('/api/integrations/zepp/connect', authMiddleware, connectZepp);
ZeppRouter.get('/api/integrations/zepp/callback', zeppCallback);
ZeppRouter.get('/api/integrations/zepp/status', authMiddleware, getZeppStatus);
ZeppRouter.delete('/api/integrations/zepp', authMiddleware, disconnectZeppAccount);

module.exports = ZeppRouter;
