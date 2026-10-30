const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    SetupClub,
    UpdateClub,
    ListCoaches,
    CreateJoinRequest,
    AcceptJoinRequest,
    DeclineJoinRequest,
    CreateProgram,
    UpdateProgram,
    GetProgram,
    ListPrograms,
    AssignProgram,
    ClubHome,
    AthleteDetail,
} = require('../controllers/Club/ClubControllers');

const ClubRouter = express.Router();

ClubRouter.post('/api/club/setup', authMiddleware, SetupClub);
ClubRouter.patch('/api/club/setup', authMiddleware, UpdateClub);
ClubRouter.get('/api/coaches', authMiddleware, ListCoaches);
ClubRouter.post('/api/club/join-requests', authMiddleware, CreateJoinRequest);
ClubRouter.post('/api/club/join-requests/:id/accept', authMiddleware, AcceptJoinRequest);
ClubRouter.post('/api/club/join-requests/:id/decline', authMiddleware, DeclineJoinRequest);
ClubRouter.post('/api/club/programs', authMiddleware, CreateProgram);
ClubRouter.get('/api/club/programs', authMiddleware, ListPrograms);
ClubRouter.get('/api/club/programs/:id', authMiddleware, GetProgram);
ClubRouter.patch('/api/club/programs/:id', authMiddleware, UpdateProgram);
ClubRouter.post('/api/club/programs/:id/assign', authMiddleware, AssignProgram);
ClubRouter.get('/api/club/home', authMiddleware, ClubHome);
ClubRouter.get('/api/club/athletes/:id', authMiddleware, AthleteDetail);

module.exports = ClubRouter;
