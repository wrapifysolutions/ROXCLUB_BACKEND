const {
    getWorkoutDetail,
    saveWorkout,
    unsaveWorkout,
    listSavedWorkouts,
} = require('../../lib/workouts/workoutService');

function sendWorkoutError(res, error, logLabel) {
    if (error.code === 'WORKOUT_NOT_FOUND') {
        return res.status(404).json({ error: 'WORKOUT_NOT_FOUND' });
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
};
