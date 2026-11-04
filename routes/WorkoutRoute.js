const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    GetWorkout,
    SaveWorkout,
    UnsaveWorkout,
    ListSavedWorkouts,
    ListWorkouts,
    GetTrainOverview,
    AssistTrain,
    RecommendTrain,
    SwapTrain,
    ExplainTrain,
    ListCategories,
    ListCategoryWorkouts,
} = require('../controllers/Workouts/WorkoutControllers');

const WorkoutRouter = express.Router();
const assistLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'train-assist' });

WorkoutRouter.get('/api/categories', authMiddleware, ListCategories);
WorkoutRouter.get('/api/categories/:categoryId/workouts', authMiddleware, ListCategoryWorkouts);
WorkoutRouter.get('/api/me/saved-workouts', authMiddleware, ListSavedWorkouts);
WorkoutRouter.get('/api/train/overview', authMiddleware, GetTrainOverview);
WorkoutRouter.post('/api/train/assist', authMiddleware, assistLimit, AssistTrain);
WorkoutRouter.get('/api/train/recommend', authMiddleware, RecommendTrain);
WorkoutRouter.get('/api/train/alternatives', authMiddleware, SwapTrain);
WorkoutRouter.get('/api/train/explain', authMiddleware, ExplainTrain);
WorkoutRouter.get('/api/workouts', authMiddleware, ListWorkouts);
WorkoutRouter.get('/api/workouts/:id', authMiddleware, GetWorkout);
WorkoutRouter.post('/api/workouts/:id/save', authMiddleware, SaveWorkout);
WorkoutRouter.delete('/api/workouts/:id/save', authMiddleware, UnsaveWorkout);

module.exports = WorkoutRouter;
