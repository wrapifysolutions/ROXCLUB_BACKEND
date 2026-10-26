const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    GetTodayCheckin,
    SubmitCheckin,
    DismissCheckin,
    GetPerformanceReadiness,
} = require('../controllers/Readiness/ReadinessControllers');

const ReadinessRouter = express.Router();

ReadinessRouter.get('/api/readiness/checkin/today', authMiddleware, GetTodayCheckin);
ReadinessRouter.post('/api/readiness/checkin', authMiddleware, SubmitCheckin);
ReadinessRouter.post('/api/readiness/checkin/dismiss', authMiddleware, DismissCheckin);
ReadinessRouter.get('/api/performance/readiness', authMiddleware, GetPerformanceReadiness);
module.exports = ReadinessRouter;
