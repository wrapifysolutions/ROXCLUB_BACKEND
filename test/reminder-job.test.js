const test = require('node:test');
const assert = require('node:assert/strict');
const {
    hourInZone,
    inReminderWindow,
    reminderHour,
    runTrainingReminderJob,
    runTrainingReminderJobIfLeader,
} = require('../lib/notifications/reminderJob');

function harness({ session = null, users = [{ id: 'user-1', timezone: 'UTC' }] } = {}) {
    const db = { users, session, todayQueries: 0 };
    const query = async (sql, params = []) => {
        if (sql.includes('notify:reminder_users')) {
            return { rows: db.users };
        }
        if (sql.includes('notify:today_pending')) {
            db.todayQueries += 1;
            if (!db.session) return { rows: [] };
            return { rows: [db.session] };
        }
        throw new Error(`unexpected sql: ${sql.trim().slice(0, 80)}`);
    };
    return { db, query };
}

test('reminder window is local morning plus a short catch-up', () => {
    assert.equal(reminderHour(), 8);
    assert.equal(inReminderWindow(8, 8), true);
    assert.equal(inReminderWindow(10, 8), true);
    assert.equal(inReminderWindow(11, 8), false);
    assert.equal(inReminderWindow(7, 8), false);
    assert.equal(hourInZone('UTC', new Date('2026-11-11T08:15:00Z')), 8);
});

test('reminder job only loads today session inside the morning window', async () => {
    const { db, query } = harness({
        session: { id: 'plan-1', title: 'Foundation Protocol A', duration_min: 45, scheduled_on: '2026-11-11' },
    });
    const morning = await runTrainingReminderJob(new Date('2026-11-11T08:10:00Z'), query);
    assert.equal(morning.sent, 1);
    assert.equal(db.todayQueries, 1);
    const evening = await runTrainingReminderJob(new Date('2026-11-11T19:10:00Z'), query);
    assert.equal(evening.sent, 0);
    assert.equal(evening.skippedHour, 1);
});

test('reminder job skips users with no pending session today', async () => {
    const { query } = harness({ session: null });
    const result = await runTrainingReminderJob(new Date('2026-11-11T08:10:00Z'), query);
    assert.equal(result.sent, 0);
    assert.equal(result.users, 1);
});

test('reminder leader lock skips the second replica', async () => {
    process.env.CACHE_DRIVER = 'memory';
    delete process.env.CACHE_DISABLED;
    delete require.cache[require.resolve('../lib/cache/redis')];
    delete require.cache[require.resolve('../lib/notifications/reminderJob')];
    const cache = require('../lib/cache/redis');
    cache.resetMemoryForTests();
    const reminder = require('../lib/notifications/reminderJob');
    const query = async () => ({ rows: [] });
    const first = await reminder.runTrainingReminderJobIfLeader(new Date('2026-11-11T08:10:00Z'), query);
    const second = await reminder.runTrainingReminderJobIfLeader(new Date('2026-11-11T08:10:00Z'), query);
    assert.equal(first.skipped, undefined);
    assert.equal(second.skipped, true);
});
