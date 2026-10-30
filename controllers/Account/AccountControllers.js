const {
    selectAccountType,
    submitCoachApplication,
    attachApplicationDocument,
    listOwnApplications,
} = require('../../lib/account/accountService');
const { assertApprovedCoach } = require('../../lib/admin/coachReviewService');
const {
    listApplications,
    getApplication,
    reviewApplication,
} = require('../../lib/admin/coachReviewService');
const { storageStatus } = require('../../lib/storage/privateObjectStorage');

function sendError(res, error, label) {
    if (error.status && error.code && error.status < 600) {
        if (error.status >= 500) console.error(label, error.message);
        return res.status(error.status).json({
            error: error.code,
            message: error.message,
        });
    }
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'REQUEST_FAILED',
            message: error.message,
        });
    }
    console.error(label, error);
    return res.status(500).json({ message: 'Internal Server Error' });
}

const SelectAccountType = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const result = await selectAccountType(req.user.id, req.body || {});
        return res.status(200).json(result);
    } catch (error) {
        return sendError(res, error, 'SelectAccountType error');
    }
};

const SubmitCoachApplication = async (req, res) => {
    try {
        if (!req.user?.id || !req.user.email) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }
        const body = { ...(req.body || {}) };
        if (req.file) {
            body.file = {
                buffer: req.file.buffer,
                filename: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
            };
        }
        const application = await submitCoachApplication(
            req.user.id,
            String(req.user.email).trim().toLowerCase(),
            body
        );
        const storage = storageStatus();
        return res.status(201).json({
            application,
            documentUpload: {
                enabled: storage.enabled,
                stored: application.documentAvailable,
                provider: storage.provider,
                code: storage.code,
                message: application.documentAvailable
                    ? 'Certification file stored.'
                    : 'Application saved. The certification file was not in this request.',
                upload: application.documentAvailable
                    ? null
                    : `POST /api/coach/applications/${application.id}/document`,
            },
        });
    } catch (error) {
        return sendError(res, error, 'SubmitCoachApplication error');
    }
};

const AttachCoachDocument = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        if (!req.file) {
            return res.status(400).json({
                error: 'FILE_REQUIRED',
                message: 'Send the certification as multipart form-data in the file field',
            });
        }
        const saved = await attachApplicationDocument(req.user.id, req.params.id, {
            buffer: req.file.buffer,
            filename: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
        });
        return res.status(200).json({
            application: saved.application,
            documentUpload: {
                enabled: true,
                stored: true,
                provider: saved.provider,
                message: 'Certification file stored.',
            },
        });
    } catch (error) {
        return sendError(res, error, 'AttachCoachDocument error');
    }
};

const GetMyCoachApplications = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await listOwnApplications(req.user.id);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'GetMyCoachApplications error');
    }
};

const CoachProtectedProbe = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        await assertApprovedCoach(req.user.id);
        return res.status(501).json({
            error: 'CLUB_NOT_IMPLEMENTED',
            message: 'Approved coach access is granted. Club assignment is not implemented.',
        });
    } catch (error) {
        return sendError(res, error, 'CoachProtectedProbe error');
    }
};

const AdminListApplications = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await listApplications(req.user.id, req.query?.status || 'pending');
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'AdminListApplications error');
    }
};

const AdminGetApplication = async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await getApplication(req.user.id, req.params.id);
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, 'AdminGetApplication error');
    }
};

const AdminReview = (action) => async (req, res) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'Unauthorized Access' });
        const payload = await reviewApplication(req.user.id, req.params.id, action, req.body || {});
        return res.status(200).json(payload);
    } catch (error) {
        return sendError(res, error, `AdminReview ${action} error`);
    }
};

module.exports = {
    SelectAccountType,
    SubmitCoachApplication,
    AttachCoachDocument,
    GetMyCoachApplications,
    CoachProtectedProbe,
    AdminListApplications,
    AdminGetApplication,
    AdminReview,
};
