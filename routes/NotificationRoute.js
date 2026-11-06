const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    RegisterDevice,
    UnregisterDevice,
    ListNotifications,
    MarkNotificationRead,
    MarkAllNotificationsRead,
} = require('../controllers/Notifications/NotificationControllers');

const NotificationRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'notification-write' });

NotificationRouter.post('/api/notifications/device', authMiddleware, writeLimit, RegisterDevice);
NotificationRouter.delete('/api/notifications/device', authMiddleware, writeLimit, UnregisterDevice);
NotificationRouter.get('/api/notifications', authMiddleware, ListNotifications);
NotificationRouter.post('/api/notifications/read-all', authMiddleware, writeLimit, MarkAllNotificationsRead);
NotificationRouter.post('/api/notifications/:id/read', authMiddleware, writeLimit, MarkNotificationRead);

module.exports = NotificationRouter;
