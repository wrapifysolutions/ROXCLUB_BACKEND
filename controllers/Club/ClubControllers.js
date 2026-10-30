const { isoDate } = require('../../lib/onboarding/schedule');
const { resolveUserTimezone } = require('../../lib/readiness/userTimezone');
const {
    createClub,
    updateClub,
    listCoaches,
    requestJoin,
    reviewJoin,
    clubHome,
    athleteDetail,
} = require('../../lib/club/clubService');
const {
    createCoachProgram,
    updateCoachProgram,
    getCoachProgram,
    listCoachPrograms,
    assignCoachProgram,
} = require('../../lib/club/coachProgramService');

function sendError(res, error, logLabel) {
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'CLUB_ERROR',
            message: error.message,
            ...(error.workoutIds ? { workoutIds: error.workoutIds } : {}),
            ...(error.athleteIds ? { athleteIds: error.athleteIds } : {}),
            ...(error.dates ? { dates: error.dates } : {}),
            ...(error.missingWeeks ? { missingWeeks: error.missingWeeks } : {}),
        });
    }
    console.error(logLabel, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

async function todayFor(req) {
    const requested = req.query?.timezone || req.body?.timezone;
    const zone = await resolveUserTimezone(req.user.id, requested);
    return isoDate(zone);
}

const SetupClub = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const club = await createClub(req.user.id, req.body || {});
        return res.status(201).json({ club });
    } catch (error) {
        return sendError(res, error, 'SetupClub error');
    }
};

const UpdateClub = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const club = await updateClub(req.user.id, req.body || {});
        return res.status(200).json({ club });
    } catch (error) {
        return sendError(res, error, 'UpdateClub error');
    }
};

const ListCoaches = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await listCoaches();
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'ListCoaches error');
    }
};

const CreateJoinRequest = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const request = await requestJoin(req.user.id, req.body || {});
        return res.status(201).json({ request });
    } catch (error) {
        return sendError(res, error, 'CreateJoinRequest error');
    }
};

const AcceptJoinRequest = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const membership = await reviewJoin(req.user.id, req.params.id, 'accept', today);
        return res.status(200).json({ membership });
    } catch (error) {
        return sendError(res, error, 'AcceptJoinRequest error');
    }
};

const DeclineJoinRequest = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const membership = await reviewJoin(req.user.id, req.params.id, 'decline', null);
        return res.status(200).json({ membership });
    } catch (error) {
        return sendError(res, error, 'DeclineJoinRequest error');
    }
};

const CreateProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const program = await createCoachProgram(req.user.id, req.body || {});
        return res.status(201).json({ program });
    } catch (error) {
        return sendError(res, error, 'CreateProgram error');
    }
};

const UpdateProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const program = await updateCoachProgram(req.user.id, req.params.id, req.body || {});
        return res.status(200).json({ program });
    } catch (error) {
        return sendError(res, error, 'UpdateProgram error');
    }
};

const GetProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const program = await getCoachProgram(req.user.id, req.params.id);
        return res.status(200).json({ program });
    } catch (error) {
        return sendError(res, error, 'GetClubProgram error');
    }
};

const ListPrograms = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await listCoachPrograms(req.user.id);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'ListClubPrograms error');
    }
};

const AssignProgram = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const today = await todayFor(req);
        const assignment = await assignCoachProgram(req.user.id, req.params.id, req.body || {}, today);
        return res.status(200).json({ assignment });
    } catch (error) {
        return sendError(res, error, 'AssignProgram error');
    }
};

const ClubHome = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const home = await clubHome(req.user.id);
        return res.status(200).json(home);
    } catch (error) {
        return sendError(res, error, 'ClubHome error');
    }
};

const AthleteDetail = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const athlete = await athleteDetail(req.user.id, req.params.id);
        return res.status(200).json(athlete);
    } catch (error) {
        return sendError(res, error, 'AthleteDetail error');
    }
};

module.exports = {
    SetupClub,
    UpdateClub,
    ListCoaches,
    CreateJoinRequest,
    AcceptJoinRequest,
    DeclineJoinRequest,
    CreateProgram,
    UpdateProgram,
    GetProgram,
    ListPrograms,
    AssignProgram,
    ClubHome,
    AthleteDetail,
};
