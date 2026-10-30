const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const {
    ListPrograms,
    GetProgram,
    GetMyProgram,
    EnrollProgram,
} = require('../controllers/Programs/ProgramsControllers');

const ProgramsRouter = express.Router();

ProgramsRouter.get('/api/programs/me', authMiddleware, GetMyProgram);
ProgramsRouter.get('/api/programs', authMiddleware, ListPrograms);
ProgramsRouter.get('/api/programs/:id', authMiddleware, GetProgram);
ProgramsRouter.post('/api/programs/:id/enroll', authMiddleware, EnrollProgram);

module.exports = ProgramsRouter;
