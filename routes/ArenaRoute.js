const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    GetArenaHome,
    GetArenaEvent,
    GetArenaRules,
    GetArenaLeaderboard,
    GetArenaHistory,
    GetArenaHistoryItem,
    GetArenaStrategy,
    PutArenaStrategy,
    StartArenaEvent,
    GetArenaSession,
    CheckpointArenaSession,
    FinishArenaSession,
    AbandonArenaSession,
    GetCoachArenaEventForm,
    SubmitCoachArenaEvent,
    ListCoachArenaEvents,
    AdminListArenaEvents,
    AdminPublishArenaEvent,
    AdminRejectArenaEvent,
} = require('../controllers/Arena/ArenaControllers');

const ArenaRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'arena-write' });

ArenaRouter.get('/api/arena', authMiddleware, GetArenaHome);
ArenaRouter.get('/api/arena/leaderboard', authMiddleware, GetArenaLeaderboard);
ArenaRouter.get('/api/arena/history', authMiddleware, GetArenaHistory);
ArenaRouter.get('/api/arena/history/:id', authMiddleware, GetArenaHistoryItem);
ArenaRouter.get('/api/arena/events/:id', authMiddleware, GetArenaEvent);
ArenaRouter.get('/api/arena/events/:id/rules', authMiddleware, GetArenaRules);
ArenaRouter.get('/api/arena/events/:id/strategy', authMiddleware, GetArenaStrategy);
ArenaRouter.put('/api/arena/events/:id/strategy', authMiddleware, writeLimit, PutArenaStrategy);
ArenaRouter.post('/api/arena/events/:id/start', authMiddleware, writeLimit, StartArenaEvent);
ArenaRouter.get('/api/arena/sessions/:id', authMiddleware, GetArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/checkpoint', authMiddleware, writeLimit, CheckpointArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/finish', authMiddleware, writeLimit, FinishArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/abandon', authMiddleware, writeLimit, AbandonArenaSession);


ArenaRouter.post('/api/coach/arena/events', authMiddleware, writeLimit, SubmitCoachArenaEvent);
ArenaRouter.get('/api/coach/arena/events', authMiddleware, ListCoachArenaEvents);
ArenaRouter.get('/api/admin/arena/events', authMiddleware, AdminListArenaEvents);
ArenaRouter.post('/api/admin/arena/events/:id/publish', authMiddleware, writeLimit, AdminPublishArenaEvent);
ArenaRouter.post('/api/admin/arena/events/:id/reject', authMiddleware, writeLimit, AdminRejectArenaEvent);

module.exports = ArenaRouter;
