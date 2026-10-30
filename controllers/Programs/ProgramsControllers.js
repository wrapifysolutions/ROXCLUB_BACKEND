const { isoDate } = require('../../lib/onboarding/schedule');
const { resolveUserTimezone } = require('../../lib/readiness/userTimezone');
const {
    listPrograms,
    getProgram,
    getMyProgram,
    enrollProgram,
} = require('../../lib/programs/programService');

function programsErrorResponse(error) {
    if (error.status && error.status < 500) {
        return {
            status: error.status,
            body: { error: error.code || 'PROGRAM_ERROR', message: error.message },
        };
    }
    return { status: 500, body: { message: 'Internal Server Error' } };
}

function sendError(res, error, logLabel) {
    const response = programsErrorResponse(error);
    if (response.status >= 500) console.error(logLabel, error);
    return res.status(response.status).json(response.body);
}

async function todayFor(req) {
    const requested = req.query?.timezone || req.body?.timezone;
    const zone = await resolveUserTimezone(req.user.id, requested);
    return isoDate(zone);
}

const ListPrograms = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const payload = await listPrograms(req.user.id, today);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'ListPrograms error');
    }
};

const GetProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await getProgram(req.user.id, req.params.id);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'GetProgram error');
    }
};

const GetMyProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const payload = await getMyProgram(req.user.id, today);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'GetMyProgram error');
    }
};

const EnrollProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const startDate = req.body?.startDate || today;
        const result = await enrollProgram(req.user.id, req.params.id, today, { startDate });
        const me = await getMyProgram(req.user.id, today);
        return res.status(201).json({ ...result, enrollment: me.enrollment });
    } catch (error) {
        return sendError(res, error, 'EnrollProgram error');
    }
};

module.exports = {
    ListPrograms,
    GetProgram,
    GetMyProgram,
    EnrollProgram,
    programsErrorResponse,
};
