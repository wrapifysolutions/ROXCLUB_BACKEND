const {
    getWorkoutDetail,
    saveWorkout,
    unsaveWorkout,
    listSavedWorkouts,
    listCategoryWorkouts,
    listWorkouts,
} = require('../../lib/workouts/workoutService');
const { listCategories } = require('../../lib/workouts/workoutCatalog');
const { getTrainOverview } = require('../../lib/workouts/trainOverview');
const { getTrainAssist } = require('../../lib/workouts/trainAssist');
const {
    createUserWorkout,
    updateUserWorkout,
    listUserWorkouts,
    toDetail,
    toListItem,
} = require('../../lib/workouts/userWorkoutService');

function sendWorkoutError(res, error, logLabel) {
    if (error.code === 'WORKOUT_NOT_FOUND' || error.code === 'CATEGORY_NOT_FOUND') {
        return res.status(404).json({ error: error.code });
    }
    if (error.status && error.status < 500) {
        return res.status(error.status).json({ error: error.code, message: error.message });
    }
    console.error(logLabel, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

const GetWorkout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const workout = await getWorkoutDetail(userId, req.params.id);
        return res.status(200).json(workout);
    } catch (error) {
        return sendWorkoutError(res, error, 'GetWorkout error');
    }
};

const SaveWorkout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await saveWorkout(userId, req.params.id);
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'SaveWorkout error');
    }
};

const UnsaveWorkout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await unsaveWorkout(userId, req.params.id);
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'UnsaveWorkout error');
    }
};

const ListWorkouts = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = listWorkouts({
            categoryId: req.query?.categoryId,
            type: req.query?.type,
            difficulty: req.query?.difficulty,
            maxDuration: req.query?.maxDuration,
            q: req.query?.q,
            limit: req.query?.limit,
            cursor: req.query?.cursor,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'ListWorkouts error');
    }
};

const GetTrainOverview = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const overview = await getTrainOverview(req.user.id, {
            timezone: req.query?.timezone,
        });
        return res.status(200).json(overview);
    } catch (error) {
        return sendWorkoutError(res, error, 'GetTrainOverview error');
    }
};

const ListCategories = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        return res.status(200).json({ categories: listCategories() });
    } catch (error) {
        return sendWorkoutError(res, error, 'ListCategories error');
    }
};

const ListCategoryWorkouts = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await listCategoryWorkouts(userId, req.params.categoryId);
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'ListCategoryWorkouts error');
    }
};

const AssistTrain = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const result = await getTrainAssist(req.user.id, {
            ...body,
            q: body.q ?? req.query?.q,
            workoutId: body.workoutId ?? req.query?.workoutId,
            intent: body.intent ?? req.query?.intent,
            categoryId: body.categoryId ?? req.query?.categoryId,
            type: body.type ?? req.query?.type,
            difficulty: body.difficulty ?? req.query?.difficulty,
            maxDuration: body.maxDuration ?? req.query?.maxDuration,
            limit: body.limit ?? req.query?.limit,
            timezone: body.timezone ?? req.query?.timezone,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'AssistTrain error');
    }
};

const RecommendTrain = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await getTrainAssist(req.user.id, {
            intent: 'recommend',
            q: req.query?.q,
            categoryId: req.query?.categoryId,
            type: req.query?.type,
            difficulty: req.query?.difficulty,
            maxDuration: req.query?.maxDuration,
            limit: req.query?.limit,
            timezone: req.query?.timezone,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'RecommendTrain error');
    }
};

const SwapTrain = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await getTrainAssist(req.user.id, {
            intent: 'swap',
            workoutId: req.query?.workoutId,
            limit: req.query?.limit,
            timezone: req.query?.timezone,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'SwapTrain error');
    }
};

const ExplainTrain = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await getTrainAssist(req.user.id, {
            intent: 'explain',
            workoutId: req.query?.workoutId,
            timezone: req.query?.timezone,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendWorkoutError(res, error, 'ExplainTrain error');
    }
};

const CreateUserWorkout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const workout = await createUserWorkout(userId, req.body || {});
        return res.status(201).json(toDetail(workout, false));
    } catch (error) {
        return sendWorkoutError(res, error, 'CreateUserWorkout error');
    }
};

const ListUserWorkouts = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const workouts = await listUserWorkouts(userId);
        return res.status(200).json({ workouts: workouts.map((workout) => toListItem(workout)) });
    } catch (error) {
        return sendWorkoutError(res, error, 'ListUserWorkouts error');
    }
};

const UpdateUserWorkout = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const workout = await updateUserWorkout(userId, req.params.id, req.body || {});
        return res.status(200).json(toDetail(workout, false));
    } catch (error) {
        return sendWorkoutError(res, error, 'UpdateUserWorkout error');
    }
};

const ListSavedWorkouts = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ message: 'Unauthorized Access' });
        const workouts = await listSavedWorkouts(userId);
        return res.status(200).json({ workouts });
    } catch (error) {
        return sendWorkoutError(res, error, 'ListSavedWorkouts error');
    }
};

module.exports = {
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
};
