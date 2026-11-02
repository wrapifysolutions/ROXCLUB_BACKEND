const { getAthleteDna } = require('../../lib/athlete/dnaService');
const { getStationProficiency } = require('../../lib/athlete/proficiencyService');

function sendError(res, error, label) {
    if (error.code === 'DATABASE_NOT_READY') {
        return res.status(503).json({
            error: error.code,
            message: error.message,
        });
    }
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'ATHLETE_ERROR',
            message: error.message,
        });
    }
    console.error(label, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

function requireUser(req, res) {
    if (!req.user?.id) {
        res.status(401).json({ message: 'Unauthorized Access' });
        return null;
    }
    return req.user.id;
}

const GetAthleteDna = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getAthleteDna(userId));
    } catch (error) {
        return sendError(res, error, 'GetAthleteDna error');
    }
};

const GetStationProficiency = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getStationProficiency(userId));
    } catch (error) {
        return sendError(res, error, 'GetStationProficiency error');
    }
};

module.exports = { GetAthleteDna, GetStationProficiency };
