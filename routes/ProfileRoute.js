const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    GetProfile,
    PatchProfile,
    GetProfileShare,
    GetProfileExport,
    DeleteProfile,
} = require('../controllers/Profile/ProfileControllers');

const ProfileRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'profile-write' });
const deleteLimit = createRateLimit({ windowMs: 60000, max: 5, name: 'profile-delete' });

ProfileRouter.get('/api/profile', authMiddleware, GetProfile);
ProfileRouter.patch('/api/profile', authMiddleware, writeLimit, PatchProfile);
ProfileRouter.get('/api/profile/share', authMiddleware, GetProfileShare);
ProfileRouter.get('/api/profile/export', authMiddleware, GetProfileExport);
ProfileRouter.delete('/api/profile', authMiddleware, deleteLimit, DeleteProfile);

module.exports = ProfileRouter;
