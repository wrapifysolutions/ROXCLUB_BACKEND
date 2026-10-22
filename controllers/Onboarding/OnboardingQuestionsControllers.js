const { resolveUserLocation } = require('../../lib/location');
const { completeOnboarding } = require('../../lib/onboarding/completeOnboarding');

const createOnboardingQuestions = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const locationEnabled = Boolean(req.body?.location_enabled);
        const location = await resolveUserLocation(req, req.body, locationEnabled);
        const saved = await completeOnboarding(userId, req.body || {}, location);

        return res.status(200).json({
            message: 'Onboarding questions saved successfully',
            redirect: '/home',
            data: saved.data,
            program: saved.program,
            athlete: saved.athlete,
        });
    } catch (error) {
        if (error.status === 400) {
            return res.status(400).json({ message: error.message });
        }
        console.error('createOnboardingQuestions error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = createOnboardingQuestions;
