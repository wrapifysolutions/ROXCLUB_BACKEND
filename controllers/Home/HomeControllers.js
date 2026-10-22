const { loadHomeScreen } = require('../../lib/home/homeScreen');

const GetHomeProfile = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const home = await loadHomeScreen(userId, req.query?.timezone || req.body?.timezone);

        if (!home) {
            return res.status(404).json({
                message: 'Onboarding not completed',
                redirect: '/onboarding/name',
            });
        }

        return res.status(200).json(home);
    } catch (error) {
        console.error('GetHomeProfile error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = { GetHomeProfile };
