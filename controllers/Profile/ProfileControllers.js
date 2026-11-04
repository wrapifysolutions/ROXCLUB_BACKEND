const { clearAuthCookie } = require('../../lib/token');
const {
    getProfile,
    updateProfile,
    getShareCard,
    exportProfile,
    deleteAccount,
} = require('../../lib/profile/profileService');

function sendError(res, error, label) {
    if (error.status === 400 || error.status === 404 || error.status === 409) {
        return res.status(error.status).json({
            error: error.code || 'PROFILE_ERROR',
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

const GetProfile = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getProfile(userId));
    } catch (error) {
        return sendError(res, error, 'GetProfile error');
    }
};

const PatchProfile = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await updateProfile(userId, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'PatchProfile error');
    }
};

const GetProfileShare = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getShareCard(userId, req.query?.activityId));
    } catch (error) {
        return sendError(res, error, 'GetProfileShare error');
    }
};

const GetProfileExport = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await exportProfile(userId));
    } catch (error) {
        return sendError(res, error, 'GetProfileExport error');
    }
};

const DeleteProfile = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        const result = await deleteAccount(userId, req.body || {});
        clearAuthCookie(res);
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'DeleteProfile error');
    }
};

module.exports = {
    GetProfile,
    PatchProfile,
    GetProfileShare,
    GetProfileExport,
    DeleteProfile,
};
