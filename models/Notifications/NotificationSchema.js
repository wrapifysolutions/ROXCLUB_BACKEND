const createNotificationsTable = `
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(60) NOT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createNotificationsUserIndex = `
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;
`;

const createNotificationsOnceKeyIndex = `
CREATE INDEX IF NOT EXISTS notifications_once_key_idx
    ON notifications (user_id, type, ((data->>'onceKey')))
    WHERE data ? 'onceKey';
`;

const createDevicePushTokensTable = `
CREATE TABLE IF NOT EXISTS device_push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(20) NOT NULL DEFAULT 'android',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (token)
);
`;

const createDevicePushTokensUserIndex = `
CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
    ON device_push_tokens (user_id, updated_at DESC);
`;

const notificationStatements = [
    createNotificationsTable,
    createNotificationsUserIndex,
    createNotificationsOnceKeyIndex,
    createDevicePushTokensTable,
    createDevicePushTokensUserIndex,
];

module.exports = {
    notificationStatements,
    createNotificationsTable,
    createDevicePushTokensTable,
};
