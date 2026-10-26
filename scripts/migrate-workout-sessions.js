require('dotenv').config();

const { ensureOnboardingProfileSchema } = require('../lib/onboarding/schema');

async function main() {
    await ensureOnboardingProfileSchema();
    console.log('workout session tables are ready');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
