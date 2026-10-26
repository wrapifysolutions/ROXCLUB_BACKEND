const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');

function isIanaTimeZone(value) {
    if (typeof value !== 'string') return false;
    const zone = value.trim();
    if (!zone || zone.length > 80) return false;
    try {
        Intl.DateTimeFormat('en-CA', { timeZone: zone }).format();
        return true;
    } catch (_) {
        return false;
    }
}

async function saveUserTimezone(userId, timeZone, query = queryWithHardTimeout) {
    if (!userId || !isIanaTimeZone(timeZone)) return null;
    const zone = timeZone.trim();
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    await query(
        `
        /* readiness:save_timezone */
        UPDATE users
        SET timezone = $2, updated_at = NOW()
        WHERE id = $1 AND timezone IS DISTINCT FROM $2
        `,
        [userId, zone],
        8000
    );
    return zone;
}

async function resolveUserTimezone(userId, requested, query = queryWithHardTimeout) {
    if (isIanaTimeZone(requested)) {
        const zone = requested.trim();
        await saveUserTimezone(userId, zone, query).catch(() => {});
        return zone;
    }
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    try {
        const { rows } = await query(
            `
            /* readiness:load_timezone */
            SELECT timezone
            FROM users
            WHERE id = $1
            `,
            [userId],
            8000
        );
        return isIanaTimeZone(rows[0]?.timezone) ? rows[0].timezone : 'UTC';
    } catch (error) {
        if (error.code === '42703') return 'UTC';
        throw error;
    }
}

module.exports = {
    isIanaTimeZone,
    saveUserTimezone,
    resolveUserTimezone,
};
