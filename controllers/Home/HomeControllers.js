const { queryWithHardTimeout } = require('../../lib/dbQuery');
const { getHomeWatchData } = require('../../lib/home/athleteDna');
const { ensureOnboardingProfileSchema } = require('../../lib/onboarding/schema');
const {
    ensureBaselineAthlete,
    normalizeExperience,
    normalizeRace,
} = require('../../lib/onboarding/completeOnboarding');

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

        await ensureOnboardingProfileSchema();

        const { rows } = await queryWithHardTimeout(
            `
            SELECT
                COALESCE(u.display_name, oq.display_name) AS display_name,
                oq.is_completed,
                COALESCE(u.experience_level, oq.training_experience) AS experience_level,
                oq.training_goals,
                ap.program_key,
                ap.program_name,
                ap.dna_status,
                ap.level,
                ap.xp
            FROM onboarding_questions oq
            JOIN users u ON u.id = oq.user_id
            LEFT JOIN athlete_profiles ap ON ap.user_id = oq.user_id
            WHERE oq.user_id = $1
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

        let athlete = profile.program_key
            ? {
                  program_key: profile.program_key,
                  program_name: profile.program_name,
                  dna_status: profile.dna_status,
                  level: profile.level,
                  xp: profile.xp,
              }
            : null;

        if (!athlete) {
            athlete = await ensureBaselineAthlete(
                userId,
                normalizeRace(profile.training_goals) || 'general_fitness',
                normalizeExperience(profile.experience_level) || 'beginner'
            );
        }

        const displayName = String(profile.display_name).trim();
        const watchData = await getHomeWatchData(userId);

        return res.status(200).json({
            display_name: displayName,
            first_name: firstNameFrom(displayName),
            this_week: watchData.this_week,
            athlete_dna: watchData.athlete_dna,
            program: athlete
                ? { key: athlete.program_key, name: athlete.program_name }
                : null,
            athlete: athlete
                ? {
                      dna_status: athlete.dna_status,
                      level: athlete.level,
                      xp: athlete.xp,
                  }
                : null,
        });
    } catch (error) {
        console.error('GetHomeProfile error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = { GetHomeProfile };
