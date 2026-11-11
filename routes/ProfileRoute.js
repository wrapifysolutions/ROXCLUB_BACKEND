const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const { MAX_PHOTO_BYTES } = require('../lib/storage/profilePhoto');
const {
    GetProfile,
    PatchProfile,
    UploadProfilePhoto,
    DeleteProfilePhoto,
    GetProfileShare,
    GetProfileExport,
    DeleteProfile,
} = require('../controllers/Profile/ProfileControllers');

const ProfileRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'profile-write' });
const photoLimit = createRateLimit({ windowMs: 60000, max: 10, name: 'profile-photo' });
const deleteLimit = createRateLimit({ windowMs: 60000, max: 5, name: 'profile-delete' });
const photoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES },
});

function acceptProfilePhoto(req, res, next) {
    photoUpload.single('file')(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
            error: 'FILE_INVALID',
            message: tooLarge
                ? 'Profile photo must be a JPEG, PNG, or WebP up to 5 MB'
                : 'Profile photo could not be read',
        });
    });
}

ProfileRouter.get('/api/profile', authMiddleware, GetProfile);
ProfileRouter.patch('/api/profile', authMiddleware, writeLimit, PatchProfile);
ProfileRouter.post('/api/profile/photo', authMiddleware, photoLimit, acceptProfilePhoto, UploadProfilePhoto);
ProfileRouter.delete('/api/profile/photo', authMiddleware, photoLimit, DeleteProfilePhoto);
ProfileRouter.get('/api/profile/share', authMiddleware, GetProfileShare);
ProfileRouter.get('/api/profile/export', authMiddleware, GetProfileExport);
ProfileRouter.delete('/api/profile', authMiddleware, deleteLimit, DeleteProfile);

module.exports = ProfileRouter;
