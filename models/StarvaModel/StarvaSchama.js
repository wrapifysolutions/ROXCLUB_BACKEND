const createUserIntegrationsTable = `
CREATE TABLE IF NOT EXISTS user_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,

    provider VARCHAR(30) NOT NULL
        CHECK (
            provider IN ('strava', 'zepp', 'apple_health')
        ),

    provider_user_id VARCHAR(255),

    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,

    token_expires_at TIMESTAMPTZ,

    status VARCHAR(20) NOT NULL DEFAULT 'disconnected'
        CHECK (
            status IN (
                'connected',
                'disconnected',
                'expired',
                'error'
            )
        ),

    connected_at TIMESTAMPTZ,
    disconnected_at TIMESTAMPTZ,

    last_synced_at TIMESTAMPTZ,
    last_sync_status VARCHAR(20)
        CHECK (
            last_sync_status IN (
                'success',
                'failed',
                'pending'
            )
        ),

    last_error TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT unique_user_provider
        UNIQUE (user_id, provider)
);
`;

const createOAuthStatesTable = `
CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY,
    user_id UUID NOT NULL
        REFERENCES users(id) ON DELETE CASCADE,
    provider VARCHAR(30) NOT NULL
        CHECK (
            provider IN ('strava', 'zepp', 'apple_health')
        ),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createOAuthStatesIndex = `
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at
    ON oauth_states (expires_at);
`;

module.exports = {
    createUserIntegrationsTable,
    createOAuthStatesTable,
    createOAuthStatesIndex,
};
