-- Initial PostgreSQL schema for the local-first learning build.
-- Apply through a numbered migration before adding application code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_user (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    display_name TEXT NOT NULL DEFAULT 'Local user',
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX app_user_email_lower_idx ON app_user (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE app_session (
    token_hash TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX app_session_expiry_idx ON app_session(expires_at);

CREATE TABLE project (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id),
    title TEXT NOT NULL,
    topic TEXT NOT NULL,
    audience TEXT NOT NULL CHECK (audience IN ('KIDS', 'TEENS', 'ADULT_BEGINNERS')),
    target_duration_seconds INTEGER NOT NULL CHECK (target_duration_seconds IN (30, 45, 60)),
    language TEXT NOT NULL DEFAULT 'EN' CHECK (language = 'EN'),
    status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
        'DRAFT', 'SCRIPT_GENERATING', 'SCRIPT_REVIEW', 'ASSETS_GENERATING',
        'ASSETS_READY', 'NARRATION_GENERATING', 'NARRATION_READY',
        'RENDER_QUEUED', 'RENDERING', 'RENDERED', 'APPROVED', 'SCHEDULED',
        'PUBLISHED', 'FAILED', 'ARCHIVED'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

CREATE TABLE project_version (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL CHECK (version_number > 0),
    script JSONB NOT NULL DEFAULT '{}'::jsonb,
    storyboard_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES app_user(id),
    UNIQUE (project_id, version_number)
);

CREATE UNIQUE INDEX project_version_one_current_idx
    ON project_version(project_id) WHERE is_current = TRUE;

CREATE TABLE scene (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id UUID NOT NULL REFERENCES project_version(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    scene_kind TEXT NOT NULL CHECK (scene_kind IN ('HOOK', 'EXPLANATION', 'EXAMPLE', 'RECAP')),
    narration_text TEXT NOT NULL,
    on_screen_text TEXT NOT NULL DEFAULT '',
    visual_prompt TEXT NOT NULL DEFAULT '',
    target_duration_ms INTEGER CHECK (target_duration_ms IS NULL OR target_duration_ms > 0),
    review_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_version_id, position)
);

CREATE TABLE source (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id UUID NOT NULL REFERENCES project_version(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    excerpt TEXT,
    publisher TEXT,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    retrieval_provider TEXT NOT NULL,
    citation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (project_version_id, url)
);

CREATE TABLE claim_source (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id UUID NOT NULL REFERENCES scene(id) ON DELETE CASCADE,
    source_id UUID REFERENCES source(id) ON DELETE SET NULL,
    claim_text TEXT NOT NULL,
    support_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW'
        CHECK (support_status IN ('SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'NEEDS_REVIEW')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE asset (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    project_version_id UUID REFERENCES project_version(id) ON DELETE CASCADE,
    scene_id UUID REFERENCES scene(id) ON DELETE SET NULL,
    asset_type TEXT NOT NULL CHECK (asset_type IN (
        'SCENE_ILLUSTRATION', 'NARRATION_AUDIO', 'CAPTIONS',
        'BACKGROUND_MUSIC', 'REEL_COVER', 'FINAL_VIDEO'
    )),
    storage_key TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL,
    byte_size BIGINT CHECK (byte_size IS NULL OR byte_size >= 0),
    checksum_sha256 TEXT,
    provider TEXT NOT NULL,
    provider_model TEXT,
    generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE generation_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    project_version_id UUID REFERENCES project_version(id) ON DELETE SET NULL,
    job_type TEXT NOT NULL CHECK (job_type IN (
        'SCRIPT_GENERATION', 'SCENE_ILLUSTRATION', 'NARRATION_GENERATION',
        'PUBLISHING_ASSETS_GENERATION', 'VIDEO_RENDER', 'INSTAGRAM_PUBLISH',
        'ASSET_CLEANUP'
    )),
    status TEXT NOT NULL DEFAULT 'QUEUED'
        CHECK (status IN ('QUEUED', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    progress JSONB NOT NULL DEFAULT '{}'::jsonb,
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
    idempotency_key TEXT NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_code TEXT,
    error_message_safe TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, idempotency_key)
);

CREATE TABLE social_account (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id),
    provider TEXT NOT NULL DEFAULT 'INSTAGRAM' CHECK (provider = 'INSTAGRAM'),
    platform_account_id TEXT NOT NULL,
    username TEXT,
    account_type TEXT,
    encrypted_access_token TEXT NOT NULL,
    encryption_key_version TEXT NOT NULL DEFAULT 'v1',
    token_expires_at TIMESTAMPTZ,
    granted_scopes TEXT[] NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'CONNECTED'
        CHECK (status IN ('CONNECTED', 'REAUTH_REQUIRED', 'DISCONNECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, platform_account_id)
);

CREATE TABLE scheduled_post (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    project_version_id UUID NOT NULL REFERENCES project_version(id),
    social_account_id UUID REFERENCES social_account(id) ON DELETE SET NULL,
    video_asset_id UUID NOT NULL REFERENCES asset(id),
    cover_asset_id UUID REFERENCES asset(id),
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    scheduled_at TIMESTAMPTZ NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'SCHEDULED'
        CHECK (status IN ('SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED')),
    platform_post_id TEXT,
    last_error_code TEXT,
    last_error_message_safe TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approval (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    project_version_id UUID NOT NULL REFERENCES project_version(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES asset(id),
    stage TEXT NOT NULL CHECK (stage IN ('STORYBOARD', 'FINAL_RENDER')),
    approved_by UUID REFERENCES app_user(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX approval_storyboard_once_idx
    ON approval(project_version_id) WHERE stage = 'STORYBOARD';
CREATE UNIQUE INDEX approval_final_render_once_idx
    ON approval(project_version_id, asset_id) WHERE stage = 'FINAL_RENDER';

CREATE TABLE video_review (
    asset_id UUID PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    state_hash TEXT NOT NULL UNIQUE,
    encrypted_pkce_verifier TEXT,
    redirect_uri TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX project_owner_updated_idx ON project(owner_id, updated_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX scene_version_position_idx ON scene(project_version_id, position);
CREATE INDEX source_version_idx ON source(project_version_id);
CREATE INDEX claim_source_scene_idx ON claim_source(scene_id);
CREATE INDEX asset_project_version_type_idx ON asset(project_id, project_version_id, asset_type);
CREATE INDEX job_ready_idx ON generation_job(status, next_attempt_at, created_at)
    WHERE status IN ('QUEUED', 'RETRY_WAIT');
CREATE INDEX job_project_idx ON generation_job(project_id, created_at DESC);
CREATE INDEX post_calendar_idx ON scheduled_post(owner_id, scheduled_at)
    WHERE status IN ('SCHEDULED', 'PUBLISHING');
CREATE INDEX post_account_status_idx ON scheduled_post(social_account_id, status, scheduled_at);
CREATE INDEX oauth_state_expiry_idx ON oauth_state(expires_at)
    WHERE consumed_at IS NULL;
CREATE INDEX video_review_owner_updated_idx ON video_review(owner_id, updated_at DESC);
