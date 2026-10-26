const { isoDate } = require('../../lib/onboarding/schedule');
const { resolveUserTimezone } = require('../../lib/readiness/userTimezone');
const {
    getTodayCheckin,
    dismissCheckin,
    submitCheckin,
} = require('../../lib/readiness/checkinService');
const { ensureTodayReadiness } = require('../../lib/readiness/readinessService');

function sendError(res, error, logLabel) {
    if (error.code === 'INVALID_CHECKIN') {
        return res.status(400).json({ message: error.message });
    }
    console.error(logLabel, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

async function todayFor(req) {
    const requested = req.body?.timezone || req.query?.timezone;
    const zone = await resolveUserTimezone(req.user.id, requested);
    return isoDate(zone);
}

const GetTodayCheckin = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const result = await getTodayCheckin(req.user.id, today);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'GetTodayCheckin error');
    }
};

const SubmitCheckin = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const result = await submitCheckin(req.user.id, req.body, today);
        return res.status(200).json(result.readiness);
    } catch (error) {
        return sendError(res, error, 'SubmitCheckin error');
    }
};

const DismissCheckin = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const result = await dismissCheckin(req.user.id, today);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'DismissCheckin error');
    }
};

const GetPerformanceReadiness = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const payload = await ensureTodayReadiness(req.user.id, today);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'GetPerformanceReadiness error');
    }
};

module.exports = {
    GetTodayCheckin,
    SubmitCheckin,
    DismissCheckin,
    GetPerformanceReadiness,
};
