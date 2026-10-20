const pool = require('../lib/pool');
const {
    createOnboardingQuestionsTable,
    alterOnboardingExtraColumns,
} = require('../models/Onboarding/OnboardingQuestions');

async function main() {
    await pool.query(createOnboardingQuestionsTable);
    await pool.query(alterOnboardingExtraColumns);

    const cols = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'onboarding_questions'
          AND (
            column_name LIKE 'avatar%'
            OR column_name IN ('notifications_enabled', 'location_enabled')
          )
        ORDER BY column_name
    `);

    console.log(cols.rows.map((row) => row.column_name).join(', ') || 'no columns');
    await pool.end();
}

main().catch(async (error) => {
    console.error(error.message);
    try {
        await pool.end();
    } catch (_) {}
    process.exit(1);
});
