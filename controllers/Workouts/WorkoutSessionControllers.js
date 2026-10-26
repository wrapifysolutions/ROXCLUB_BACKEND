const { isoDate } = require('../../lib/onboarding/schedule');
const { resolveUserTimezone } = require('../../lib/readiness/userTimezone');
const {
    startSession,
    getActiveSession,
    saveProgress,
    cancelSession,
    completeSession,
} = require('../../lib/workout/sessionService');
const { submitDebrief } = require('../../lib/workout/debriefService');

function sendError(res, error, logLabel) {
    if (error.code === 'SESSION_IN_PROGRESS') {
        return res.status(409).json({ error: 'SESSION_IN_PROGRESS', sessionId: error.sessionId });
    }
    if (error.status && error.status < 500) {
        return res.status(error.status).json({ error: error.code, message: error.message });
    }
    if (error.code === '22P02') {
        return res.status(400).json({
            error: 'INVALID_ID',
            message: 'Use the sessionId from POST /api/workout-sessions/start, or the workout id of the open session.',
        });
    }
    console.error(logLabel, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

async function localDateFor(req) {
    const requested = req.body?.timezone || req.query?.timezone;
    const zone = await resolveUserTimezone(req.user.id, requested);
    return isoDate(zone);
}

const StartWorkoutSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const localDate = await localDateFor(req);
        const session = await startSession(req.user.id, req.body, { localDate });
        return res.status(200).json(session);
    } catch (error) {
        return sendError(res, error, 'StartWorkoutSession error');
    }
};

const GetActiveWorkoutSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const session = await getActiveSession(req.user.id);
        return res.status(200).json(session);
    } catch (error) {
        return sendError(res, error, 'GetActiveWorkoutSession error');
    }
};

const SaveWorkoutProgress = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const saved = await saveProgress(req.user.id, req.params.id, req.body);
        return res.status(200).json(saved);
    } catch (error) {
        return sendError(res, error, 'SaveWorkoutProgress error');
    }
};

const CancelWorkoutSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await cancelSession(req.user.id, req.params.id);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'CancelWorkoutSession error');
    }
};

const CompleteWorkoutSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await completeSession(req.user.id, req.params.id, req.body);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'CompleteWorkoutSession error');
    }
};

const SubmitActivityDebrief = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await submitDebrief(req.user.id, req.params.id, req.body);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'SubmitActivityDebrief error');
    }
};

module.exports = {
    StartWorkoutSession,
    GetActiveWorkoutSession,
    SaveWorkoutProgress,
    CancelWorkoutSession,
    CompleteWorkoutSession,
    SubmitActivityDebrief,
};
