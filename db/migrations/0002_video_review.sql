CREATE TABLE IF NOT EXISTS video_review (
    asset_id UUID PRIMARY KEY REFERENCES asset(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    caption TEXT NOT NULL DEFAULT '',
    hashtags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS video_review_owner_updated_idx ON video_review(owner_id, updated_at DESC);
