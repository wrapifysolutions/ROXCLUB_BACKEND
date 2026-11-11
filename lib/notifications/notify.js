const crypto = require('crypto');
const { queryWithHardTimeout } = require('../dbQuery');
const { notificationStatements } = require('../../models/Notifications/NotificationSchema');
const { isConfigured, sendToToken } = require('./fcm');

const TEMPLATES = {
    welcome: {
        title: 'ROXCLUB is ready',
        body: 'Notifications are on. We will ping you for sessions, Level Ups, and training updates.',
        path: '/home',
    },
    workout_completed: {
        title: 'Workout logged',
        body: 'Your session is in the log. Open Home to see XP.',
        path: '/home',
    },
    level_up: {
        title: 'Level Up',
        body: 'Your training just raised your Level. Open ROXCLUB to see the athlete.',
        path: '/home',
    },
    badge_earned: {
        title: 'New badge',
        body: 'You earned a badge. Open Home to see it.',
        path: '/home',
    },
    mission_complete: {
        title: 'Mission complete',
        body: 'A mission just paid out. Open Home to claim the win.',
        path: '/home',
    },
    session_missed: {
        title: 'You missed a session',
        body: 'Open Train to reschedule or skip.',
        path: '/train',
    },
    today_workout: {
        title: "Today's session is ready",
        body: 'Open Train and get this one done.',
        path: '/train',
    },
    activity_imported: {
        title: 'Activity synced',
        body: 'A connected workout just landed in your log.',
        path: '/home',
    },
    club_accepted: {
        title: 'Club request accepted',
        body: 'You are in. Open the club to see your training.',
        path: '/club',
    },
    program_assigned: {
        title: 'New program on your calendar',
        body: 'Your coach assigned a program. Check this week in Train.',
        path: '/train',
    },
};

let tableReady = false;

function runQuery(query, sql, params) {
    if (query === queryWithHardTimeout) return query(sql, params, 8000);
    return query(sql, params);
}

function httpError(code, status, message) {
    const error = new Error(message || code);
    error.code = code;
    error.status = status;
    return error;
}

async function ensureNotificationTables(query = queryWithHardTimeout) {
    if (query !== queryWithHardTimeout) {
        for (const statement of notificationStatements) {
            try {
                await runQuery(query, statement, []);
            } catch (error) {
                if (error.code !== '42P01' && error.code !== '42703') throw error;
            }
        }
        return;
    }
    if (tableReady) return;
    try {
        for (const statement of notificationStatements) {
            await queryWithHardTimeout(statement, [], 8000);
        }
        tableReady = true;
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return;
        throw error;
    }
}

function asObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_) {
        return {};
    }
}

function cleanToken(value) {
    const token = String(value || '').trim();
    if (!token || token.length > 4096) return null;
    return token;
}

function cleanPlatform(value) {
    const platform = String(value || 'android').trim().toLowerCase();
    if (['ios', 'android', 'web'].includes(platform)) return platform;
    return 'android';
}

function isLiveFanout() {
    return process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT;
}

function stringData(data) {
    const out = {};
    for (const [key, value] of Object.entries(data || {})) {
        if (value == null) continue;
        out[key] = typeof value === 'string' ? value : String(value);
    }
    return out;
}

async function notificationsEnabled(userId, query) {
    try {
        const { rows } = await runQuery(
            query,
            `
            /* notify:opt_in */
            SELECT notifications_enabled
            FROM onboarding_questions
            WHERE user_id = $1
            `,
            [userId]
        );
        return Boolean(rows[0]?.notifications_enabled);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return false;
        throw error;
    }
}

async function registerDeviceToken(userId, body, query = queryWithHardTimeout) {
    const token = cleanToken(body?.token || body?.push_token || body?.fcm_token);
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    if (!token) throw httpError('INVALID_PUSH_TOKEN', 400, 'token is required');
    await ensureNotificationTables(query);
    await runQuery(
        query,
        `
        /* notify:upsert_token */
        INSERT INTO device_push_tokens (id, user_id, token, platform)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token)
        DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()
        `,
        [crypto.randomUUID(), userId, token, cleanPlatform(body?.platform)]
    );
    return { registered: true, platform: cleanPlatform(body?.platform) };
}

async function removeDeviceToken(userId, body, query = queryWithHardTimeout) {
    const token = cleanToken(body?.token || body?.push_token || body?.fcm_token);
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    if (!token) throw httpError('INVALID_PUSH_TOKEN', 400, 'token is required');
    await ensureNotificationTables(query);
    await runQuery(
        query,
        `
        /* notify:delete_token */
        DELETE FROM device_push_tokens
        WHERE user_id = $1 AND token = $2
        `,
        [userId, token]
    );
    return { registered: false };
}

async function loadTokens(userId, query) {
    try {
        const { rows } = await runQuery(
            query,
            `
            /* notify:list_tokens */
            SELECT token
            FROM device_push_tokens
            WHERE user_id = $1
            ORDER BY updated_at DESC
            LIMIT 8
            `,
            [userId]
        );
        return rows.map((row) => row.token).filter(Boolean);
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') return [];
        throw error;
    }
}

async function dropInvalidToken(token, query) {
    try {
        await runQuery(query, `DELETE FROM device_push_tokens WHERE token = $1`, [token]);
    } catch (_) {}
}

async function insertInbox(userId, event, query) {
    const id = crypto.randomUUID();
    await runQuery(
        query,
        `
        /* notify:insert */
        INSERT INTO notifications (id, user_id, type, title, body, data)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        `,
        [id, userId, event.type, event.title, event.body, JSON.stringify(event.data || {})]
    );
    return id;
}

async function notifyUser(userId, input = {}, options = {}) {
    const type = String(input.type || '').trim();
    const template = TEMPLATES[type];
    if (!userId || !template) {
        return { delivered: false, reason: 'INVALID_NOTIFICATION' };
    }
    const query = options.query || queryWithHardTimeout;
    try {
        await ensureNotificationTables(query);
        const enabled = await notificationsEnabled(userId, query);
        if (!enabled) return { delivered: false, reason: 'NOTIFICATIONS_DISABLED' };

        const onceKey = String(input.onceKey || input.data?.onceKey || '').trim() || null;
        if (input.once || onceKey) {
            const existing = await runQuery(
                query,
                onceKey
                    ? `
                /* notify:once_key */
                SELECT id
                FROM notifications
                WHERE user_id = $1 AND type = $2 AND data->>'onceKey' = $3
                ORDER BY created_at DESC
                LIMIT 1
                `
                    : `
                /* notify:once */
                SELECT id
                FROM notifications
                WHERE user_id = $1 AND type = $2
                ORDER BY created_at DESC
                LIMIT 1
                `,
                onceKey ? [userId, type, onceKey] : [userId, type]
            );
            if (existing.rows[0]) {
                return {
                    delivered: false,
                    reason: 'ALREADY_NOTIFIED',
                    notificationId: existing.rows[0].id,
                };
            }
        }

        const title = input.title || template.title;
        const body = input.body || template.body;
        const data = stringData({
            type,
            path: input.path || template.path,
            ...(onceKey ? { onceKey } : {}),
            ...(input.data || {}),
        });
        const notificationId = await insertInbox(userId, { type, title, body, data }, query);
        data.notificationId = notificationId;

        const tokens = await loadTokens(userId, query);
        if (tokens.length === 0) {
            return { delivered: false, reason: 'NO_PUSH_TOKEN', notificationId };
        }
        if (!isConfigured()) {
            return { delivered: false, reason: 'NO_NOTIFICATION_PROVIDER', notificationId };
        }

        let delivered = false;
        for (const token of tokens) {
            const result = await sendToToken(token, { title, body, data });
            if (result.invalidToken) await dropInvalidToken(token, query);
            if (result.delivered) delivered = true;
        }
        return {
            delivered,
            reason: delivered ? null : 'FCM_SEND_FAILED',
            notificationId,
        };
    } catch (error) {
        if (
            error.code === '42P01' ||
            error.code === '42703' ||
            error.code === '22P02' ||
            error.code === '23503'
        ) {
            return { delivered: false, reason: 'NO_NOTIFICATION_PROVIDER' };
        }
        console.error('notifyUser error', error.message);
        return { delivered: false, reason: 'NOTIFY_FAILED' };
    }
}

function notifyLater(userId, input) {
    Promise.resolve()
        .then(() => notifyUser(userId, input))
        .catch((error) => console.error('notifyLater error', error.message));
}

async function listNotifications(userId, options = {}) {
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    const query = options.query || queryWithHardTimeout;
    try {
        await ensureNotificationTables(query);
        const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
        const { rows } = await runQuery(
            query,
            `
            /* notify:list */
            SELECT id, type, title, body, data, read_at, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT $2
            `,
            [userId, limit]
        );
        const unread = await runQuery(
            query,
            `
            /* notify:unread_count */
            SELECT COUNT(*)::int AS count
            FROM notifications
            WHERE user_id = $1 AND read_at IS NULL
            `,
            [userId]
        );
        return {
            notifications: rows.map((row) => ({
                id: row.id,
                type: row.type,
                title: row.title,
                body: row.body,
                data: asObject(row.data),
                read: Boolean(row.read_at),
                createdAt: row.created_at,
            })),
            unreadCount: Number(unread.rows[0]?.count) || 0,
        };
    } catch (error) {
        if (error.code === '42P01' || error.code === '42703') {
            return { notifications: [], unreadCount: 0 };
        }
        throw error;
    }
}

async function markRead(userId, notificationId, query = queryWithHardTimeout) {
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    try {
        await ensureNotificationTables(query);
        const { rows } = await runQuery(
            query,
            `
            /* notify:read */
            UPDATE notifications
            SET read_at = COALESCE(read_at, NOW())
            WHERE id = $1 AND user_id = $2
            RETURNING id
            `,
            [notificationId, userId]
        );
        if (!rows[0]) throw httpError('NOTIFICATION_NOT_FOUND', 404, 'Notification not found');
        return { read: true, id: rows[0].id };
    } catch (error) {
        if (error.status === 404) throw error;
        if (error.code === '22P02' || error.code === '42P01') {
            throw httpError('NOTIFICATION_NOT_FOUND', 404, 'Notification not found');
        }
        throw error;
    }
}

function shouldFanout(options) {
    return !options?.query;
}

async function markAllRead(userId, query = queryWithHardTimeout) {
    if (!userId) throw httpError('UNAUTHORIZED', 401, 'Unauthorized Access');
    await ensureNotificationTables(query);
    await runQuery(
        query,
        `
        /* notify:read_all */
        UPDATE notifications
        SET read_at = NOW()
        WHERE user_id = $1 AND read_at IS NULL
        `,
        [userId]
    );
    return { read: true };
}

module.exports = {
    TEMPLATES,
    ensureNotificationTables,
    registerDeviceToken,
    removeDeviceToken,
    notifyUser,
    notifyLater,
    listNotifications,
    markRead,
    markAllRead,
    shouldFanout,
    isLiveFanout,
};
