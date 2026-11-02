const {
    getArenaHome,
    listEvents,
    getEvent,
    getEventRules,
    joinEvent,
    getStrategy,
    saveStrategy,
    getHistory,
    getHistoryItem,
    getLeaderboard,
} = require('../../lib/arena/arenaService');
const {
    startEvent,
    getSession,
    checkpoint,
    finishSession,
    abandonSession,
} = require('../../lib/arena/sessionService');
const { explainArena } = require('../../lib/arena/arenaAiService');
const { loadEngineInputs } = require('../../lib/athlete/engineInputs');

function sendError(res, error, label) {
    if (error.code === 'DATABASE_NOT_READY') {
        return res.status(503).json({
            error: error.code,
            message: error.message,
        });
    }
    if (error.status && error.status < 500) {
        return res.status(error.status).json({
            error: error.code || 'ARENA_ERROR',
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

const GetArenaHome = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getArenaHome(userId));
    } catch (error) {
        return sendError(res, error, 'GetArenaHome error');
    }
};

const ListArenaEvents = async (req, res) => {
    try {
        if (!requireUser(req, res)) return;
        return res.status(200).json(await listEvents());
    } catch (error) {
        return sendError(res, error, 'ListArenaEvents error');
    }
};

const GetArenaEvent = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getEvent(req.params.id, userId));
    } catch (error) {
        return sendError(res, error, 'GetArenaEvent error');
    }
};

const GetArenaRules = async (req, res) => {
    try {
        if (!requireUser(req, res)) return;
        return res.status(200).json(await getEventRules(req.params.id));
    } catch (error) {
        return sendError(res, error, 'GetArenaRules error');
    }
};

const GetArenaLeaderboard = async (req, res) => {
    try {
        if (!requireUser(req, res)) return;
        return res.status(200).json(await getLeaderboard({ queryParams: req.query || {} }));
    } catch (error) {
        return sendError(res, error, 'GetArenaLeaderboard error');
    }
};

const GetArenaHistory = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getHistory(userId, { queryParams: req.query || {} }));
    } catch (error) {
        return sendError(res, error, 'GetArenaHistory error');
    }
};

const GetArenaHistoryItem = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getHistoryItem(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'GetArenaHistoryItem error');
    }
};

const JoinArenaEvent = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(201).json(await joinEvent(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'JoinArenaEvent error');
    }
};

const GetArenaStrategy = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getStrategy(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'GetArenaStrategy error');
    }
};

const PutArenaStrategy = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await saveStrategy(userId, req.params.id, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'PutArenaStrategy error');
    }
};

const GetArenaEngineInputs = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await loadEngineInputs(userId));
    } catch (error) {
        return sendError(res, error, 'GetArenaEngineInputs error');
    }
};

const StartArenaEvent = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(201).json(await startEvent(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'StartArenaEvent error');
    }
};

const GetArenaSession = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await getSession(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'GetArenaSession error');
    }
};

const CheckpointArenaSession = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await checkpoint(userId, req.params.id, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'CheckpointArenaSession error');
    }
};

const FinishArenaSession = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await finishSession(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'FinishArenaSession error');
    }
};

const ExplainArena = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await explainArena(userId, req.body || {}));
    } catch (error) {
        return sendError(res, error, 'ExplainArena error');
    }
};

const AbandonArenaSession = async (req, res) => {
    try {
        const userId = requireUser(req, res);
        if (!userId) return;
        return res.status(200).json(await abandonSession(userId, req.params.id));
    } catch (error) {
        return sendError(res, error, 'AbandonArenaSession error');
    }
};

module.exports = {
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
};
