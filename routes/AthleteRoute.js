const express = require('express');
const authMiddleware = require('../middlewares/auth.middleware');
const { GetAthleteDna, GetStationProficiency } = require('../controllers/Athlete/AthleteControllers');

const AthleteRouter = express.Router();

AthleteRouter.get('/api/athlete/dna', authMiddleware, GetAthleteDna);
AthleteRouter.get('/api/athlete/station-proficiency', authMiddleware, GetStationProficiency);

module.exports = AthleteRouter;
