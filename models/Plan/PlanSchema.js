const createMissedSessionsTable = `
CREATE TABLE IF NOT EXISTS missed_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scheduled_session_id UUID NOT NULL REFERENCES scheduled_sessions(id) ON DELETE CASCADE,
    missed_on DATE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
    action VARCHAR(40),
    suggestion JSONB,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (scheduled_session_id)
);
`;

const createMissedSessionsIndex = `
CREATE INDEX IF NOT EXISTS missed_sessions_user_status_idx
    ON missed_sessions (user_id, status, missed_on DESC);
`;

module.exports = {
    createMissedSessionsTable,
    createMissedSessionsIndex,
};
