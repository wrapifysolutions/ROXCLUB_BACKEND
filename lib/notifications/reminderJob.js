const { queryWithHardTimeout } = require('../dbQuery');
const { ensureOnboardingProfileSchema } = require('../onboarding/schema');
const { isoDate } = require('../onboarding/schedule');
const cache = require('../cache/redis');
const { fanoutTodayWorkout } = require('./events');

function reminderHour() {
    const hour = Number(process.env.TRAINING_REMINDER_HOUR);
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) return hour;
    return 8;
}

function hourInZone(timeZone, now = new Date()) {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone || 'UTC',
            hour: 'numeric',
            hourCycle: 'h23',
        }).formatToParts(now);
        return Number(parts.find((part) => part.type === 'hour')?.value);
    } catch (_) {
        return now.getUTCHours();
    }
}

function inReminderWindow(localHour, hour = reminderHour()) {
    if (!Number.isFinite(localHour)) return false;
    const end = hour + 3;
    if (end <= 24) return localHour >= hour && localHour < end;
    return localHour >= hour || localHour < end - 24;
}

async function loadTodayPending(userId, today, query) {
    const { rows } = await query(
        `
        /* notify:today_pending */
        SELECT id, title, duration_min, scheduled_on::text AS scheduled_on, status, completed_at
        FROM scheduled_sessions
        WHERE user_id = $1
          AND scheduled_on = $2::date
          AND completed_at IS NULL
          AND (status IS NULL OR status = 'pending')
        LIMIT 1
        `,
        [userId, today]
    );
    return rows[0] || null;
}

async function runTrainingReminderJob(now = new Date(), query = queryWithHardTimeout) {
    if (query === queryWithHardTimeout) await ensureOnboardingProfileSchema();
    const hour = reminderHour();
    const { rows } = await query(
        `
        /* notify:reminder_users */
        SELECT u.id, u.timezone
        FROM users u
        JOIN onboarding_questions oq ON oq.user_id = u.id
        WHERE u.onboarding_completed = TRUE
          AND oq.notifications_enabled = TRUE
        `,
        []
    );
    let sent = 0;
    let skippedHour = 0;
    for (const user of rows) {
        const zone = user.timezone || 'UTC';
        const localHour = hourInZone(zone, now);
        if (!inReminderWindow(localHour, hour)) {
            skippedHour += 1;
            continue;
        }
        const today = isoDate(zone, now);
        const session = await loadTodayPending(user.id, today, query);
        if (!session) continue;
        fanoutTodayWorkout(user.id, session, today);
        sent += 1;
    }
    return { users: rows.length, sent, skippedHour, hour };
}

async function runTrainingReminderJobIfLeader(now = new Date(), query = queryWithHardTimeout) {
    const locked = await cache.setNx('job:training-reminders', String(Date.now()), 3300);
    if (!locked) return { skipped: true, users: 0, sent: 0 };
    return runTrainingReminderJob(now, query);
}

function scheduleReminderJob() {
    const hourMs = 60 * 60 * 1000;
    const run = () => {
        runTrainingReminderJobIfLeader().catch((error) => {
            console.error('training reminder job', error.message);
        });
    };
    const startup = setTimeout(run, 20000);
    const timer = setInterval(run, hourMs);
    if (typeof startup.unref === 'function') startup.unref();
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

module.exports = {
    reminderHour,
    hourInZone,
    inReminderWindow,
    runTrainingReminderJob,
    runTrainingReminderJobIfLeader,
    scheduleReminderJob,
};
