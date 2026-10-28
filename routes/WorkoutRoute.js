const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    GetWorkout,
    SaveWorkout,
    UnsaveWorkout,
    ListSavedWorkouts,
    ListWorkouts,
    GetTrainOverview,
    ListCategories,
    ListCategoryWorkouts,
} = require('../controllers/Workouts/WorkoutControllers');

const WorkoutRouter = express.Router();

WorkoutRouter.get('/api/categories', authMiddleware, ListCategories);
WorkoutRouter.get('/api/categories/:categoryId/workouts', authMiddleware, ListCategoryWorkouts);
WorkoutRouter.get('/api/me/saved-workouts', authMiddleware, ListSavedWorkouts);
WorkoutRouter.get('/api/train/overview', authMiddleware, GetTrainOverview);
WorkoutRouter.get('/api/workouts', authMiddleware, ListWorkouts);
WorkoutRouter.get('/api/workouts/:id', authMiddleware, GetWorkout);
WorkoutRouter.post('/api/workouts/:id/save', authMiddleware, SaveWorkout);
WorkoutRouter.delete('/api/workouts/:id/save', authMiddleware, UnsaveWorkout);

module.exports = WorkoutRouter;
