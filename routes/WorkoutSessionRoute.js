const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
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

WorkoutSessionRouter.post('/api/workout-sessions/start', authMiddleware, StartWorkoutSession);
WorkoutSessionRouter.get('/api/workout-sessions/active', authMiddleware, GetActiveWorkoutSession);
WorkoutSessionRouter.patch('/api/workout-sessions/:id/progress', authMiddleware, SaveWorkoutProgress);
WorkoutSessionRouter.post('/api/workout-sessions/:id/cancel', authMiddleware, CancelWorkoutSession);
WorkoutSessionRouter.post('/api/workout-sessions/:id/complete', authMiddleware, CompleteWorkoutSession);
WorkoutSessionRouter.get('/api/activities', authMiddleware, ListActivityHistory);
WorkoutSessionRouter.post('/api/activities/:id/debrief', authMiddleware, SubmitActivityDebrief);

module.exports = WorkoutSessionRouter;
