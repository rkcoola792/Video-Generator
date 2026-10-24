ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_idx ON app_user (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_session (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS app_session_expiry_idx ON app_session (expires_at);
