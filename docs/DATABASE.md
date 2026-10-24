# Database Design

The proposed database is PostgreSQL. The initial DDL is [schema.sql](schema.sql). Apply schema changes through ordered migrations; do not edit a deployed schema manually.

## 1. Ownership and relations

- An `app_user` owns projects and social accounts.
- A `project` is the persistent lesson draft and workflow root.
- A `project_version` is an immutable snapshot used for approvals and renders.
- Scenes, sources, and assets belong to a version; regenerated assets are new rows.
- A scheduled post points to an approved version and render asset.
- A job records each asynchronous generation, rendering, or publishing operation.

## 2. Tables

| Table | Purpose |
|---|---|
| `app_user` | Email, display name, and a scrypt password hash for each account. |
| `app_session` | Hashed bearer token, owning user, creation time, and expiry for browser sessions. |
| `project` | Topic, audience, duration, language, and current state. |
| `project_version` | Version number, script/storyboard JSON, approval metadata. |
| `scene` | Ordered narration, visual/text fields, timing, review flags. |
| `source` | AI-found source metadata for a version. |
| `claim_source` | Links factual claims to sources and records support status. |
| `asset` | Immutable reference to audio, image, captions, music, cover, or MP4. |
| `generation_job` | Durable work queue record, progress, retries, and errors. |
| `social_account` | Instagram account identity and encrypted token material. |
| `scheduled_post` | Caption, hashtags, schedule, publish state, platform post ID. |
| `approval` | User approval for an immutable version or final render. |
| `oauth_state` | One-time OAuth state/PKCE data and expiry for CSRF protection. |

## 3. Important constraints

- `project_version.version_number` is unique within a project.
- `scene.position` is unique within a version.
- Target duration is restricted to 30, 45, or 60 seconds.
- Audience is `KIDS`, `TEENS`, or `ADULT_BEGINNERS`; language is `EN` in v1.
- Final-render approval references the exact version and render asset it approves.
- A scheduled post must point at an approved final render.
- A retry reuses the same scheduled-post row and creates a new publish job attempt.
- Passwords are never stored in plaintext. Session tokens are random, held in HTTP-only cookies, and stored as SHA-256 hashes in this table. OAuth codes are never stored in plaintext in logs. Encrypt social tokens at rest or store an encrypted secret reference.
- Asset bytes live in file/object storage, not PostgreSQL. The `asset` table stores metadata and a storage key.
- Deleting a project must enqueue asset cleanup; do not delete records while jobs are still running.

## 4. Versioning and invalidation

Edits create a new `project_version`; they do not mutate an approved version in place. Narration text edits invalidate narration, captions, and render. Visual-prompt edits invalidate that scene illustration and render. Regenerating a cover is not offered in v1. A new approved render gets a new asset and approval record.

## 5. Indexes and queries

The schema indexes projects by owner/update time, scenes by version/position, jobs by state/next-attempt time, scheduled posts by account/time, assets by project/version/type, and OAuth states by hash/expiry.

Store timestamps as UTC `timestamptz`. Convert to a user's timezone only in the calendar UI and schedule input/output. Every project and its generated media must be checked against the authenticated `owner_id` before it is returned or downloaded.

## 6. Migrations and seeds

- Store each migration as an ordered SQL file.
- Create accounts through the registration endpoint; never seed a shared user for normal use.
- Apply the ordered SQL files under `db/migrations` with `npm run db:migrate`.
- Keep provider IDs, account tokens, and generated assets out of seed files.
- Back up database metadata and file storage together before hosted launch.

## 7. Retention

For the learning build, keep drafts and assets until the user deletes the project. On deletion, disconnect social credentials and schedule storage cleanup. Do not retain access tokens after account disconnection. Define production retention periods before inviting users.
