const { queryWithHardTimeout } = require('../../lib/dbQuery');
const { getHomeWatchData } = require('../../lib/home/athleteDna');

function firstNameFrom(displayName) {
    const trimmed = String(displayName || '').trim();
    if (!trimmed) return null;
    return trimmed.split(/\s+/)[0];
}

const GetHomeProfile = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const { rows } = await queryWithHardTimeout(
            `
            SELECT display_name, is_completed
            FROM onboarding_questions
            WHERE user_id = $1
            `,
            [userId],
            8000
        );

        const profile = rows[0];

        if (!profile || !profile.is_completed || !profile.display_name) {
            return res.status(404).json({
                message: 'Onboarding not completed',
                redirect: '/onboarding/name',
            });
        }

        const displayName = String(profile.display_name).trim();
        const watchData = await getHomeWatchData(userId);

        return res.status(200).json({
            display_name: displayName,
            first_name: firstNameFrom(displayName),
            this_week: watchData.this_week,
            athlete_dna: watchData.athlete_dna,
        });
    } catch (error) {
        console.error('GetHomeProfile error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = { GetHomeProfile };
