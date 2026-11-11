const { clearAuthCookie } = require('../../lib/token');
const {
    getProfile,
    updateProfile,
    uploadProfilePhoto,
    removeProfilePhoto,
    getShareCard,
    exportProfile,
    deleteAccount,
} = require('../../lib/profile/profileService');

function sendError(res, error, label) {
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'PROFILE_ERROR',
            message: error.message,
        });
    }
    if (error.status === 502 || error.status === 503) {
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

function profilePhotoFile(req) {
    return req.file
        ? {
              buffer: req.file.buffer,
              filename: req.file.originalname,
              mimeType: req.file.mimetype,
              size: req.file.size,
          }
        : null;
}

const UploadProfilePhoto = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await uploadProfilePhoto(userId, profilePhotoFile(req)));
    } catch (error) {
        return sendError(res, error, 'UploadProfilePhoto error');
    }
};

const DeleteProfilePhoto = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await removeProfilePhoto(userId));
    } catch (error) {
        return sendError(res, error, 'DeleteProfilePhoto error');
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
    UploadProfilePhoto,
    DeleteProfilePhoto,
    GetProfileShare,
    GetProfileExport,
    DeleteProfile,
};
