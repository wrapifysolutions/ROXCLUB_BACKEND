const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { createRateLimit } = require('../lib/http/rateLimit');
const {
    GetArenaHome,
    ListArenaEvents,
    GetArenaEvent,
    GetArenaRules,
    GetArenaLeaderboard,
    GetArenaHistory,
    GetArenaHistoryItem,
    JoinArenaEvent,
    GetArenaStrategy,
    PutArenaStrategy,
    GetArenaEngineInputs,
    StartArenaEvent,
    GetArenaSession,
    CheckpointArenaSession,
    FinishArenaSession,
    AbandonArenaSession,
    ExplainArena,
} = require('../controllers/Arena/ArenaControllers');

const ArenaRouter = express.Router();
const writeLimit = createRateLimit({ windowMs: 60000, max: 40, name: 'arena-write' });

ArenaRouter.get('/api/arena', authMiddleware, GetArenaHome);
ArenaRouter.get('/api/arena/leaderboard', authMiddleware, GetArenaLeaderboard);
ArenaRouter.get('/api/arena/history', authMiddleware, GetArenaHistory);
ArenaRouter.get('/api/arena/history/:id', authMiddleware, GetArenaHistoryItem);
ArenaRouter.get('/api/arena/events', authMiddleware, ListArenaEvents);
ArenaRouter.get('/api/arena/events/:id', authMiddleware, GetArenaEvent);
ArenaRouter.get('/api/arena/events/:id/rules', authMiddleware, GetArenaRules);
ArenaRouter.post('/api/arena/events/:id/join', authMiddleware, writeLimit, JoinArenaEvent);
ArenaRouter.get('/api/arena/events/:id/strategy', authMiddleware, GetArenaStrategy);
ArenaRouter.put('/api/arena/events/:id/strategy', authMiddleware, writeLimit, PutArenaStrategy);
ArenaRouter.get('/api/arena/engine-inputs', authMiddleware, GetArenaEngineInputs);
ArenaRouter.post('/api/arena/events/:id/start', authMiddleware, writeLimit, StartArenaEvent);
ArenaRouter.get('/api/arena/sessions/:id', authMiddleware, GetArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/checkpoint', authMiddleware, writeLimit, CheckpointArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/finish', authMiddleware, writeLimit, FinishArenaSession);
ArenaRouter.post('/api/arena/sessions/:id/abandon', authMiddleware, writeLimit, AbandonArenaSession);
ArenaRouter.post('/api/arena/ai/explain', authMiddleware, ExplainArena);

module.exports = ArenaRouter;
