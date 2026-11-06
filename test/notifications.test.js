const test = require('node:test');
const assert = require('node:assert/strict');
const {
    registerDeviceToken,
    removeDeviceToken,
    notifyUser,
    listNotifications,
    markRead,
    markAllRead,
    shouldFanout,
} = require('../lib/notifications/notify');

function harness({ enabled = true } = {}) {
    const db = {
        enabled,
        tokens: [],
        inbox: [],
    };
    const query = async (sql, params = []) => {
        if (/CREATE TABLE|CREATE INDEX/i.test(sql)) return { rows: [] };
        if (sql.includes('notify:opt_in')) {
            return { rows: [{ notifications_enabled: db.enabled }] };
        }
        if (sql.includes('notify:upsert_token')) {
            const existing = db.tokens.find((row) => row.token === params[2]);
            if (existing) {
                existing.user_id = params[1];
                existing.platform = params[3];
                existing.updated_at = '2026-11-06T12:00:00.000Z';
            } else {
                db.tokens.push({
                    id: params[0],
                    user_id: params[1],
                    token: params[2],
                    platform: params[3],
                    updated_at: '2026-11-06T12:00:00.000Z',
                });
            }
            return { rows: [] };
        }
        if (sql.includes('notify:delete_token')) {
            db.tokens = db.tokens.filter((row) => !(row.user_id === params[0] && row.token === params[1]));
            return { rows: [] };
        }
        if (sql.includes('notify:list_tokens')) {
            return {
                rows: db.tokens
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
                    .slice(0, 8)
                    .map((row) => ({ token: row.token })),
            };
        }
        if (sql.includes('notify:once')) {
            const rows = db.inbox.filter((row) => row.user_id === params[0] && row.type === params[1]);
            return { rows: rows[0] ? [{ id: rows[0].id }] : [] };
        }
        if (sql.includes('notify:insert')) {
            db.inbox.push({
                id: params[0],
                user_id: params[1],
                type: params[2],
                title: params[3],
                body: params[4],
                data: params[5],
                read_at: null,
                created_at: `2026-11-06T12:00:0${db.inbox.length}Z`,
            });
            return { rows: [] };
        }
        if (sql.includes('notify:list')) {
            return {
                rows: db.inbox
                    .filter((row) => row.user_id === params[0])
                    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
                    .slice(0, params[1]),
            };
        }
        if (sql.includes('notify:read_all')) {
            for (const row of db.inbox) {
                if (row.user_id === params[0] && !row.read_at) row.read_at = '2026-11-06T12:01:00.000Z';
            }
            return { rows: [] };
        }
        if (sql.includes('notify:read')) {
            const row = db.inbox.find((item) => item.id === params[0] && item.user_id === params[1]);
            if (!row) return { rows: [] };
            row.read_at = row.read_at || '2026-11-06T12:01:00.000Z';
            return { rows: [{ id: row.id }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
    };
    return { db, query };
}

test('onboarding opt-out never writes an inbox row', async () => {
    const { query, db } = harness({ enabled: false });
    const result = await notifyUser('user-1', { type: 'welcome' }, { query });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, 'NOTIFICATIONS_DISABLED');
    assert.equal(db.inbox.length, 0);
});

test('welcome writes inbox once and skips FCM without a token', async () => {
    const { query, db } = harness();
    const first = await notifyUser('user-1', { type: 'welcome', once: true }, { query });
    const second = await notifyUser('user-1', { type: 'welcome', once: true }, { query });
    assert.equal(first.delivered, false);
    assert.equal(first.reason, 'NO_PUSH_TOKEN');
    assert.equal(second.reason, 'ALREADY_NOTIFIED');
    assert.equal(db.inbox.length, 1);
    assert.equal(db.inbox[0].type, 'welcome');
});

test('level up with a registered device stays inbox-only until Firebase is configured', async () => {
    const { query, db } = harness();
    await registerDeviceToken('user-1', { token: 'fcm-token-1', platform: 'android' }, query);
    const result = await notifyUser('user-1', { type: 'level_up', data: { level: '4' } }, { query });
    assert.equal(result.delivered, false);
    assert.equal(result.reason, 'NO_NOTIFICATION_PROVIDER');
    assert.equal(db.tokens.length, 1);
    assert.match(db.inbox[0].body, /Level Up|athlete/i);
});

test('device register, inbox list, and mark read stay scoped to the user', async () => {
    const { query } = harness();
    await registerDeviceToken('user-1', { token: 'aaa', platform: 'ios' }, query);
    await notifyUser('user-1', { type: 'club_accepted' }, { query });
    await notifyUser('user-2', { type: 'program_assigned' }, { query });
    const listed = await listNotifications('user-1', { query, limit: 10 });
    assert.equal(listed.notifications.length, 1);
    assert.equal(listed.notifications[0].read, false);
    const read = await markRead('user-1', listed.notifications[0].id, query);
    assert.equal(read.read, true);
    await markAllRead('user-1', query);
    const after = await listNotifications('user-1', { query });
    assert.equal(after.notifications[0].read, true);
    await removeDeviceToken('user-1', { token: 'aaa' }, query);
    await assert.rejects(() => registerDeviceToken('user-1', {}, query), (error) => error.status === 400);
});

test('club and session tests keep their injected query out of live FCM', () => {
    assert.equal(shouldFanout({ query: async () => ({ rows: [] }) }), false);
    assert.equal(shouldFanout({}), true);
});
