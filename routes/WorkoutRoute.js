const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const { MAX_PHOTO_BYTES } = require('../lib/workouts/novaPhoto');
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
    CreateUserWorkout,
    ListUserWorkouts,
    UpdateUserWorkout,
    ImportWorkoutPhoto,
    PaceRace,
} = require('../controllers/Workouts/WorkoutControllers');

const WorkoutRouter = express.Router();
const assistLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'train-assist' });
const photoLimit = createRateLimit({ windowMs: 60000, max: 10, name: 'train-photo' });
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES },
});

function acceptWorkoutPhoto(req, res, next) {
    photoUpload.single('file')(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
            error: 'FILE_INVALID',
            message: tooLarge
                ? 'Workout photo must be a JPEG, PNG, or WebP up to 5 MB'
                : 'Workout photo could not be read',
        });
    });
}

WorkoutRouter.get('/api/categories', authMiddleware, ListCategories);
WorkoutRouter.get('/api/categories/:categoryId/workouts', authMiddleware, ListCategoryWorkouts);
WorkoutRouter.get('/api/me/saved-workouts', authMiddleware, ListSavedWorkouts);
WorkoutRouter.get('/api/me/workouts', authMiddleware, ListUserWorkouts);
WorkoutRouter.post('/api/me/workouts', authMiddleware, assistLimit, CreateUserWorkout);
WorkoutRouter.patch('/api/me/workouts/:id', authMiddleware, assistLimit, UpdateUserWorkout);
WorkoutRouter.get('/api/train/overview', authMiddleware, GetTrainOverview);
WorkoutRouter.post('/api/train/assist', authMiddleware, assistLimit, AssistTrain);
WorkoutRouter.post('/api/train/assist/photo', authMiddleware, photoLimit, acceptWorkoutPhoto, ImportWorkoutPhoto);
WorkoutRouter.post('/api/train/pace-race', authMiddleware, assistLimit, PaceRace);
WorkoutRouter.get('/api/train/pace-race', authMiddleware, PaceRace);
WorkoutRouter.get('/api/train/recommend', authMiddleware, RecommendTrain);
WorkoutRouter.get('/api/train/alternatives', authMiddleware, SwapTrain);
WorkoutRouter.get('/api/train/explain', authMiddleware, ExplainTrain);
WorkoutRouter.get('/api/workouts', authMiddleware, ListWorkouts);
WorkoutRouter.get('/api/workouts/:id', authMiddleware, GetWorkout);
WorkoutRouter.post('/api/workouts/:id/save', authMiddleware, SaveWorkout);
WorkoutRouter.delete('/api/workouts/:id/save', authMiddleware, UnsaveWorkout);

module.exports = WorkoutRouter;
