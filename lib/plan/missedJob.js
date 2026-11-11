const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const { markMissedSessions } = require('./planService');
const cache = require('../cache/redis');
const { fanoutMissedNotifications } = require('../notifications/events');

function asInserted(value) {
    if (Array.isArray(value)) return value;
    return [];
}

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
        const inserted = asInserted(await markMissedSessions(user.id, today, query));
        marked += inserted.length;
        fanoutMissedNotifications(user.id, inserted);
    }
    return { users: rows.length, marked };
}

async function runMissedSessionJobIfLeader(now = new Date(), query = queryWithHardTimeout) {
    const locked = await cache.setNx('job:missed-sessions', String(Date.now()), 3300);
    if (!locked) return { skipped: true, users: 0, marked: 0 };
    return runMissedSessionJob(now, query);
}

function scheduleMissedJob() {
    const hourMs = 60 * 60 * 1000;
    const run = () => {
        runMissedSessionJobIfLeader().catch((error) => {
            console.error('missed session job', error.message);
        });
    };
    const startup = setTimeout(run, 25000);
    const timer = setInterval(run, hourMs);
    if (typeof startup.unref === 'function') startup.unref();
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = { runMissedSessionJob, runMissedSessionJobIfLeader, scheduleMissedJob };
