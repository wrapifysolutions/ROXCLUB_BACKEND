const {
    registerDeviceToken,
    removeDeviceToken,
    listNotifications,
    markRead,
    markAllRead,
} = require('../../lib/notifications/notify');

function sendError(res, error, label) {
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'NOTIFICATION_ERROR',
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

const RegisterDevice = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await registerDeviceToken(userId, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'RegisterDevice error');
    }
};

const UnregisterDevice = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await removeDeviceToken(userId, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'UnregisterDevice error');
    }
};

const ListNotifications = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await listNotifications(userId, { limit: req.query?.limit }));
    } catch (error) {
        return sendError(res, error, 'ListNotifications error');
    }
};

const MarkNotificationRead = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await markRead(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'MarkNotificationRead error');
    }
};

const MarkAllNotificationsRead = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await markAllRead(userId));
    } catch (error) {
        return sendError(res, error, 'MarkAllNotificationsRead error');
    }
};

module.exports = {
    RegisterDevice,
    UnregisterDevice,
    ListNotifications,
    MarkNotificationRead,
    MarkAllNotificationsRead,
};
