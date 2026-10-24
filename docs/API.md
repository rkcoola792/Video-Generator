# Application API

This document describes the HTTP API exposed by the app. The machine-readable contract is [openapi.yaml](api/openapi.yaml). It is separate from external vendor APIs described in [INTEGRATIONS.md](INTEGRATIONS.md).

## Conventions

- Base path: `/api/v1`.
- JSON request and response bodies use UTF-8.
- Asynchronous work returns `202 Accepted` with a `job` object; poll `GET /jobs/{jobId}` for progress and result.
- Send an `Idempotency-Key` UUID with every request that creates a job or scheduled post. Reusing a key and request returns the original result; reusing it with a different request returns `409 Conflict`.
- Use `If-Match: "<project-version>"` for edits to versioned project content. A stale edit returns `409 Conflict` with the current version.
- Errors use `application/problem+json` with `type`, `title`, `status`, `detail`, `instance`, and optional `code`/`requestId`.
- Lists use `limit` and opaque `cursor` pagination.

## Authentication

The local learning build can use a single local user. Keep the API boundary ready for authenticated sessions; never expose provider secrets or Instagram tokens to the browser. Public registration and multi-user roles are outside the v1 contract.

## Endpoint map

| Area | Endpoints | Purpose |
|---|---|---|
| Health | `GET /health` | Check app availability. |
| Projects | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{projectId}` | Create and manage lesson drafts. |
| Script and storyboard | `POST /projects/{projectId}/script`, `PATCH /projects/{projectId}/storyboard` | Generate the first script/storyboard and save educator edits. |
| Scene visuals | `POST /projects/{projectId}/scenes/{sceneId}/illustration` | Generate or regenerate one scene illustration. |
| Narration | `POST /projects/{projectId}/narration` | Generate audio from approved script using selected voice and tone. |
| Publishing assets | `POST /projects/{projectId}/publishing-assets` | Generate cover, caption, and hashtags. |
| Video | `POST /projects/{projectId}/render`, `GET /projects/{projectId}/download` | Render and download MP4. |
| Approval | `POST /projects/{projectId}/approvals` | Record storyboard or final-render approval. |
| Jobs | `GET /jobs/{jobId}` | Check asynchronous task progress and result. |
| Instagram | `POST /social/instagram/connect`, `GET /social/instagram/callback`, `GET /social/accounts`, `DELETE /social/accounts/{accountId}` | Connect and disconnect an authorized account. |
| Calendar and posts | `GET /calendar`, `GET/POST /posts`, `GET/PATCH/DELETE /posts/{postId}`, `POST /posts/{postId}/retry` | Schedule, inspect, edit, cancel, and retry publishing. |

## Typical workflow

1. `POST /projects` with topic, audience, and target duration.
2. `POST /projects/{id}/script` with an idempotency key.
3. Poll `GET /jobs/{jobId}`; then read the generated project and source references.
4. `PATCH /projects/{id}/storyboard` with edits and the current ETag/version.
5. `POST /projects/{id}/approvals` with `stage: "storyboard"`.
6. Start illustration generation, narration, publishing-asset generation, and render. Each returns a job ID.
7. Preview the render, then approve with `stage: "final_render"`.
8. `POST /posts` with the approved render, connected account, caption, hashtags, and schedule time.
9. Inspect `/calendar`; if a post fails, inspect it and call `/posts/{postId}/retry`.

## Design rules

- The user reviews and edits script/storyboard before production starts.
- The user reviews and approves the final render before it can be scheduled.
- One generated draft is created per idea. The API does not expose a multi-variant generation operation.
- Regenerating a scene illustration creates a new asset revision for that scene; other scene assets remain intact.
- Generation and publish operations are jobs. The API never holds a browser request open while a model or renderer runs.
- Caption and hashtag edits are stored on the scheduled post, not written back into the lesson script.
- Cover images are generated and used as-is in v1.

## Contract source

See [OpenAPI 3.1 contract](api/openapi.yaml) for request/response schemas and path details. Treat it as the app API design, not generated code; implementation may add fields while preserving the contract's behavior.
