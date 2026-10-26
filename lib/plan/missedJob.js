const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { markMissedSessions } = require('./planService');

async function runMissedSessionJob(now = new Date(), query = queryWithHardTimeout) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const { rows } = await query(
        `
        /* plan:job_users */
        SELECT id, timezone
        FROM users
        WHERE onboarding_completed = TRUE
        `,
        []
    );
    let marked = 0;
    for (const user of rows) {
        const today = isoDate(user.timezone || 'UTC', now);
        marked += await markMissedSessions(user.id, today, query);
    }
    return { users: rows.length, marked };
}

function scheduleMissedJob() {
    const dayMs = 24 * 60 * 60 * 1000;
    const timer = setInterval(() => {
        runMissedSessionJob().catch((error) => {
            console.error('missed session job', error.message);
        });
    }, dayMs);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = { runMissedSessionJob, scheduleMissedJob };
