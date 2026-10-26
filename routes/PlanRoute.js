const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    GetWeekPlan,
    GetMissedSession,
    GetMissedSuggestion,
    ResolveMissedSession,
} = require('../controllers/Plan/PlanControllers');

const PlanRouter = express.Router();

PlanRouter.get('/api/plan/week', authMiddleware, GetWeekPlan);
PlanRouter.get('/api/plan/missed', authMiddleware, GetMissedSession);
PlanRouter.get('/api/plan/missed/:id/suggestion', authMiddleware, GetMissedSuggestion);
PlanRouter.post('/api/plan/missed/:id/resolve', authMiddleware, ResolveMissedSession);

module.exports = PlanRouter;
