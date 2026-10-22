const { queryWithHardTimeout } = require('../../lib/dbQuery');
const { resolveUserLocation } = require('../../lib/location');
const {
    createOnboardingQuestionsTable,
    alterOnboardingExtraColumns,
} = require('../../models/Onboarding/OnboardingQuestions');

let onboardingQuestionsReady = false;

async function ensureOnboardingQuestionsSchema() {
    if (onboardingQuestionsReady) return;
    await queryWithHardTimeout(createOnboardingQuestionsTable, [], 8000);
    await queryWithHardTimeout(alterOnboardingExtraColumns, [], 8000);
    onboardingQuestionsReady = true;
}

const createOnboardingQuestions = async (req, res) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized Access' });
        }

        const {
            display_name,
            date_of_birth,
            gender,
            height,
            weight,
            training_experience,
            training_goals,
            notifications_enabled = false,
            location_enabled = false,
            avatar_smile,
            avatar_hair,
            avatar_kit,
            avatar_skin_tone,
            avatar_skipped = false,
        } = req.body;

        if (
            !display_name ||
            !date_of_birth ||
            !gender ||
            height == null ||
            weight == null ||
            !training_experience ||
            !training_goals
        ) {
            return res.status(400).json({
                message:
                    'display_name, date_of_birth, gender, height, weight, training_experience, and training_goals are required',
            });
        }

        const skippedAvatar = Boolean(avatar_skipped);
        const notificationsEnabled = Boolean(notifications_enabled);
        const locationEnabled = Boolean(location_enabled);
        const location = await resolveUserLocation(req, req.body, locationEnabled);

        // If user did not skip avatar step, require the 4 avatar choices from "Create your athlete"
        if (
            !skippedAvatar &&
            (!avatar_smile || !avatar_hair || !avatar_kit || !avatar_skin_tone)
        ) {
            return res.status(400).json({
                message:
                    'avatar_smile, avatar_hair, avatar_kit, and avatar_skin_tone are required (or set avatar_skipped=true)',
            });
        }

        await ensureOnboardingQuestionsSchema();

        const { rows } = await queryWithHardTimeout(
            `
            INSERT INTO onboarding_questions (
                user_id,
                display_name,
                date_of_birth,
                gender,
                height,
                weight,
                training_experience,
                training_goals,
                notifications_enabled,
                location_enabled,
                latitude,
                longitude,
                location_city,
                location_region,
                location_country,
                location_source,
                avatar_smile,
                avatar_hair,
                avatar_kit,
                avatar_skin_tone,
                avatar_skipped,
                is_completed,
                updated_at
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10,
                $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20, $21,
                TRUE, NOW()
            )
            ON CONFLICT (user_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                date_of_birth = EXCLUDED.date_of_birth,
                gender = EXCLUDED.gender,
                height = EXCLUDED.height,
                weight = EXCLUDED.weight,
                training_experience = EXCLUDED.training_experience,
                training_goals = EXCLUDED.training_goals,
                notifications_enabled = EXCLUDED.notifications_enabled,
                location_enabled = EXCLUDED.location_enabled,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                location_city = EXCLUDED.location_city,
                location_region = EXCLUDED.location_region,
                location_country = EXCLUDED.location_country,
                location_source = EXCLUDED.location_source,
                avatar_smile = EXCLUDED.avatar_smile,
                avatar_hair = EXCLUDED.avatar_hair,
                avatar_kit = EXCLUDED.avatar_kit,
                avatar_skin_tone = EXCLUDED.avatar_skin_tone,
                avatar_skipped = EXCLUDED.avatar_skipped,
                is_completed = TRUE,
                updated_at = NOW()
            RETURNING *
            `,
            [
                userId,
                display_name,
                date_of_birth,
                gender,
                height,
                weight,
                training_experience,
                training_goals,
                notificationsEnabled,
                locationEnabled,
                location.latitude,
                location.longitude,
                location.city,
                location.region,
                location.country,
                location.source,
                skippedAvatar ? null : avatar_smile,
                skippedAvatar ? null : avatar_hair,
                skippedAvatar ? null : avatar_kit,
                skippedAvatar ? null : avatar_skin_tone,
                skippedAvatar,
            ],
            8000
        );

        return res.status(200).json({
            message: 'Onboarding questions saved successfully',
            data: rows[0],
        });
    } catch (error) {
        console.error('createOnboardingQuestions error', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
};

module.exports = createOnboardingQuestions;
