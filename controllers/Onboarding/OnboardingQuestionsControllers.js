const pool = require('../../lib/pool');
const createOnboardingQuestionsTable = require('../../models/Onboarding/OnboardingQuestions');

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

        await pool.query(createOnboardingQuestionsTable);

        const { rows } = await pool.query(
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
                is_completed,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, NOW())
            ON CONFLICT (user_id)
            DO UPDATE SET
                display_name = EXCLUDED.display_name,
                date_of_birth = EXCLUDED.date_of_birth,
                gender = EXCLUDED.gender,
                height = EXCLUDED.height,
                weight = EXCLUDED.weight,
                training_experience = EXCLUDED.training_experience,
                training_goals = EXCLUDED.training_goals,
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
            ]
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
