const createZeppWebhookEventsTable = `
CREATE TABLE IF NOT EXISTS zepp_webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    event_type VARCHAR(20) NOT NULL
        CHECK (event_type IN ('activity', 'hrv', 'sleep')),

    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    provider_user_id VARCHAR(255),

    payload JSONB NOT NULL DEFAULT '{}'::jsonb,

    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const createZeppWebhookEventsIndex = `
CREATE INDEX IF NOT EXISTS idx_zepp_webhook_events_type_received
    ON zepp_webhook_events (event_type, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_zepp_webhook_events_user
    ON zepp_webhook_events (user_id, event_type, received_at DESC);
`;

module.exports = {
    createZeppWebhookEventsTable,
    createZeppWebhookEventsIndex,
};
