const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const { MAX_BYTES } = require('../lib/storage/privateObjectStorage');
const {
    SelectAccountType,
    SubmitCoachApplication,
    GetMyCoachApplications,
    CoachProtectedProbe,
    AdminListApplications,
    AdminGetApplication,
    AdminReview,
} = require('../controllers/Account/AccountControllers');

const AccountRouter = express.Router();
const certificationUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
});

function acceptCertification(req, res, next) {
    certificationUpload.single('file')(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        return res.status(400).json({
            error: 'FILE_INVALID',
            message: tooLarge
                ? 'Certification file must be a PDF, JPEG, PNG, or DOCX up to 8 MB'
                : 'Certification file could not be read',
        });
    });
}

AccountRouter.post('/api/account/type', authMiddleware, SelectAccountType);
AccountRouter.post('/api/coach/applications', authMiddleware, acceptCertification, SubmitCoachApplication);
AccountRouter.get('/api/coach/applications/me', authMiddleware, GetMyCoachApplications);
AccountRouter.post('/api/coach/club', authMiddleware, CoachProtectedProbe);

AccountRouter.get('/api/admin/coach-applications', authMiddleware, AdminListApplications);
AccountRouter.get('/api/admin/coach-applications/:id', authMiddleware, AdminGetApplication);
AccountRouter.post('/api/admin/coach-applications/:id/approve', authMiddleware, AdminReview('approve'));
AccountRouter.post('/api/admin/coach-applications/:id/reject', authMiddleware, AdminReview('reject'));
AccountRouter.post('/api/admin/coach-applications/:id/suspend', authMiddleware, AdminReview('suspend'));

module.exports = AccountRouter;
