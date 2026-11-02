const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    StartWorkoutSession,
    GetActiveWorkoutSession,
    SaveWorkoutProgress,
    CancelWorkoutSession,
    CompleteWorkoutSession,
    SubmitActivityDebrief,
    ListActivityHistory,
} = require('../controllers/Workouts/WorkoutSessionControllers');

const WorkoutSessionRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'workout-write' });

WorkoutSessionRouter.post('/api/workout-sessions/start', authMiddleware, writeLimit, StartWorkoutSession);
WorkoutSessionRouter.get('/api/workout-sessions/active', authMiddleware, GetActiveWorkoutSession);
WorkoutSessionRouter.patch('/api/workout-sessions/:id/progress', authMiddleware, SaveWorkoutProgress);
WorkoutSessionRouter.post('/api/workout-sessions/:id/cancel', authMiddleware, CancelWorkoutSession);
WorkoutSessionRouter.post('/api/workout-sessions/:id/complete', authMiddleware, writeLimit, CompleteWorkoutSession);
WorkoutSessionRouter.get('/api/activities', authMiddleware, ListActivityHistory);
WorkoutSessionRouter.post('/api/activities/:id/debrief', authMiddleware, SubmitActivityDebrief);

module.exports = WorkoutSessionRouter;
