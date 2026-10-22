const { withTransaction } = require('../../lib/dbQuery');
const { ensureOnboardingProfileSchema } = require('../../lib/onboarding/schema');
const { isoDate } = require('../../lib/onboarding/schedule');
const { runOnboardingComplete } = require('../../lib/onboarding/completeFlow');

const CompleteOnboarding = async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        await ensureOnboardingProfileSchema();
        const today = isoDate(req.body?.timezone);
        const result = await withTransaction((client) =>
            runOnboardingComplete(client, userId, { today })
        );

        return res.status(200).json({
            message: 'Onboarding complete',
            created: result.created,
            programId: result.programId,
            startDate: result.startDate,
            sessionCount: result.sessionCount,
            redirect: '/home',
        });
    } catch (error) {
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('CompleteOnboarding error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = CompleteOnboarding;
