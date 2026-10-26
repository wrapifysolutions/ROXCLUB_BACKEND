const pending = new Map();

function enqueueReadinessRecompute(userId, localDate) {
    if (!userId) return Promise.resolve(null);
    const key = String(userId);
    const existing = pending.get(key);
    if (existing) return existing;

    const run = Promise.resolve()
        .then(async () => {
            const { recomputeAndStore } = require('./readinessService');
            let date = localDate;
            if (!date) {
                const { resolveUserTimezone } = require('./userTimezone');
                const { isoDate } = require('../onboarding/schedule');
                date = isoDate(await resolveUserTimezone(userId));
            }
            return recomputeAndStore(userId, date);
        })
        .catch((error) => {
            console.error('readiness recompute failed', error.message);
            return null;
        })
        .finally(() => {
            if (pending.get(key) === run) pending.delete(key);
        });

    pending.set(key, run);
    return run;
}

function flushReadinessQueue() {
    return Promise.all([...pending.values()]);
}

module.exports = {
    enqueueReadinessRecompute,
    flushReadinessQueue,
};
