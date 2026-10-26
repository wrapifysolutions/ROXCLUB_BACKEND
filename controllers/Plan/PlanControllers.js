const { isoDate } = require('../../lib/onboarding/schedule');
const { resolveUserTimezone } = require('../../lib/readiness/userTimezone');
const { mondayOf } = require('../../lib/plan/adaptationService');
const { getWeekPlan, getMissed, getSuggestion, resolveMissed } = require('../../lib/plan/planService');

function planErrorResponse(error) {
    if (error.code === 'PLAN_CHANGED') {
        return { status: 409, body: { error: 'PLAN_CHANGED', suggestion: error.suggestion } };
    }
    if (error.status && error.status < 500) {
        return { status: error.status, body: { error: error.code, message: error.message } };
    }
    return { status: 500, body: { message: 'Internal Server Error' } };
}

function sendError(res, error, logLabel) {
    const response = planErrorResponse(error);
    if (response.status >= 500) console.error(logLabel, error);
    return res.status(response.status).json(response.body);
}

async function todayFor(req) {
    const requested = req.query?.timezone || req.body?.timezone;
    const zone = await resolveUserTimezone(req.user.id, requested);
    return isoDate(zone);
}

const GetWeekPlan = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const requested = req.query?.weekStart;
        if (requested && !/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
            return res.status(400).json({ error: 'INVALID_DATE', message: 'weekStart must be YYYY-MM-DD' });
        }
        const week = await getWeekPlan(req.user.id, today, requested ? mondayOf(requested) : mondayOf(today));
        return res.status(200).json(week);
    } catch (error) {
        return sendError(res, error, 'GetWeekPlan error');
    }
};

const GetMissedSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const missed = await getMissed(req.user.id, today);
        return res.status(200).json(missed);
    } catch (error) {
        return sendError(res, error, 'GetMissedSession error');
    }
};

const GetMissedSuggestion = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const suggestion = await getSuggestion(req.user.id, req.params.id, today);
        return res.status(200).json(suggestion);
    } catch (error) {
        return sendError(res, error, 'GetMissedSuggestion error');
    }
};

const ResolveMissedSession = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const result = await resolveMissed(req.user.id, req.params.id, req.body?.action, today, {
            planVersion: req.body?.planVersion,
        });
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'ResolveMissedSession error');
    }
};

module.exports = {
    GetWeekPlan,
    GetMissedSession,
    GetMissedSuggestion,
    ResolveMissedSession,
    planErrorResponse,
};
