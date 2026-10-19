const pool = require('../lib/pool');
const createOnboardingQuestionsTable = require('../models/Onboarding/OnboardingQuestions');

const createOnboardingQuestions = async (req, res) => {
    try {
        const {id} = req.user;
        const {data , error} = await pool.query(createOnboardingQuestionsTable , [id]);
        if (error) throw error;
        return res.status(200).json({ message: 'Onboarding questions created successfully' });
    } catch (error) {
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}


module.exports  = createOnboardingQuestions;    