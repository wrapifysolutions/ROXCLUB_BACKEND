-- Additive only. Do not run on production without explicit approval.
-- Applied by scripts/migrate.js inside a transaction as 002_activity_identity.
-- Does not create xp_ledger_activity_reason_uidx. That is 003, recorded only
-- after the index exists. Repeatable: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS activity_identity_links (
    activity_a UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    activity_b UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'unresolved',
    match_basis VARCHAR(80) NOT NULL DEFAULT 'existing_same_workout_helper',
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (activity_a, activity_b),
    CONSTRAINT activity_identity_order_check CHECK (activity_a::text < activity_b::text),
    CONSTRAINT activity_identity_status_check
        CHECK (status IN ('candidate', 'associated', 'unresolved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS activity_identity_links_user_idx
    ON activity_identity_links (user_id, status);
