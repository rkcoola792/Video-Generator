CREATE TABLE IF NOT EXISTS social_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'INSTAGRAM' CHECK (provider = 'INSTAGRAM'),
    platform_account_id TEXT NOT NULL UNIQUE,
    username TEXT,
    account_type TEXT,
    encrypted_access_token TEXT NOT NULL,
    encryption_key_version TEXT NOT NULL DEFAULT 'v1',
    token_expires_at TIMESTAMPTZ,
    granted_scopes TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'CONNECTED' CHECK (status IN ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS oauth_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    state_hash TEXT NOT NULL UNIQUE,
    encrypted_pkce_verifier TEXT,
    redirect_uri TEXT NOT NULL,
    return_asset_id UUID REFERENCES asset(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE oauth_state ADD COLUMN IF NOT EXISTS return_asset_id UUID REFERENCES asset(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS scheduled_post (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    project_version_id UUID NOT NULL REFERENCES project_version(id),
    social_account_id UUID REFERENCES social_account(id) ON DELETE SET NULL,
    video_asset_id UUID NOT NULL REFERENCES asset(id),
    cover_asset_id UUID REFERENCES asset(id),
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED')),
    platform_post_id TEXT,
    last_error_code TEXT,
    last_error_message_safe TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS oauth_state_expiry_idx ON oauth_state(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS post_account_status_idx ON scheduled_post(social_account_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS post_owner_created_idx ON scheduled_post(owner_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS post_one_active_per_asset_account_idx
    ON scheduled_post(video_asset_id, social_account_id) WHERE status = 'PUBLISHING';
