# Backend Design

## 1. Runtime shape

Use a modular TypeScript monolith with two processes from the same repository:

1. **Web/API process** handles short HTTP requests, validation, project access, and job submission.
2. **Worker process** claims durable jobs and calls AI, audio, image, rendering, and publishing providers.

The processes share PostgreSQL and object storage. During local development they run on one computer. Keep jobs persistent so process restarts do not lose generation or publishing tasks.

## 2. Backend modules

| Module | Responsibility |
|---|---|
| `projects` | Create drafts, manage project versions, update metadata, list projects. |
| `lesson-planning` | Retrieve sources, call Gemini, validate script/storyboard JSON, save claims and citations. |
| `storyboard` | Apply creator edits, enforce version checks, record approvals. |
| `assets` | Store and retrieve image, audio, caption, cover, and render files. |
| `illustrations` | Prompt construction, image-provider adapter, per-scene regeneration. |
| `narration` | ElevenLabs adapter, voice/tone mapping, audio generation, alignment/caption preparation. |
| `video` | Build Remotion input props, preview metadata, enqueue render, save render versions. |
| `publishing` | Instagram OAuth, token storage, schedule, publish, status reconciliation, retry. |
| `jobs` | Queue, claim, heartbeat, retry, failure state, idempotency, progress. |
| `calendar` | Query scheduled posts by date range and timezone. |

API route handlers should remain thin: parse, authenticate, validate, call a domain operation, return a resource or job receipt.

## 3. Provider interfaces

Keep provider code behind narrow interfaces:

```ts
interface LessonWriter {
  createDraft(input: LessonDraftInput): Promise<LessonDraftOutput>;
}
interface SourceFinder {
  findSources(input: SourceQuery): Promise<SourceReference[]>;
}
interface IllustrationGenerator {
  generate(input: IllustrationInput): Promise<GeneratedAsset>;
}
interface NarrationGenerator {
  synthesize(input: NarrationInput): Promise<GeneratedAudio>;
}
interface VideoRenderer {
  render(input: RenderInput): Promise<RenderedVideo>;
}
interface SocialPublisher {
  publish(input: PublishInput): Promise<PublishResult>;
}
```

Initial adapters: `GeminiLessonWriter`, `ElevenLabsNarrationGenerator`, `RemotionVideoRenderer`. Image, source-search, and Instagram adapters remain separate modules. Keep model IDs, voice IDs, API versions, and retry decisions in configuration, not scattered through business logic.

## 4. Script and storyboard pipeline

1. Validate topic, learner audience, and duration.
2. Create a project version and `SCRIPT_GENERATION` job in one transaction.
3. Retrieve source candidates and save title, URL, retrieval time, and excerpt.
4. Call Gemini with topic, audience, duration, source material, strict output schema, and the instruction to cite only supplied sources.
5. Parse the structured response and validate again in application code. Detect refusals, incomplete output, unsupported claims, and missing references.
6. Save one draft storyboard and link claims to sources. Flag unsupported factual claims for human review.
7. Mark the job complete; update the browser through polling or server-sent events.
8. Save educator edits as a new project version and invalidate only downstream assets that depend on changed text.

Gemini structured output can constrain a response to a JSON Schema. Keep application-side schema validation as a second boundary and handle refusal/incomplete-output cases. Preserve source citation metadata and show citations as visible, clickable references in the product UI.

## 5. Asset and render pipeline

```text
storyboard version
  ├─ scene illustration assets (one per scene; independently regenerable)
  ├─ narration audio (depends on narration text + voice + tone)
  ├─ caption cues (depend on narration audio + narration text)
  ├─ cover image (depends on final lesson title)
  └─ render (depends on selected illustrations + narration + captions + music)
```

Every asset has a stable database ID and immutable storage key. A regenerated illustration becomes a new asset revision; selecting it updates render inputs. Do not overwrite an asset used by an approved render.

Serialize composition inputs as JSON: scene list, asset URLs, captions, audio, music, dimensions, and frame rate. Use Remotion Player for preview. Render the final MP4 in the worker, store it as a versioned asset, and return a job ID/progress. Provide downloads through short-lived signed URLs.

## 6. Job system

Use a PostgreSQL-backed durable queue for local-first development; a worker can claim ready jobs with row locks and `SKIP LOCKED`. Move to a hosted queue only if throughput requires it.

Job types:

- `SCRIPT_GENERATION`
- `SCENE_ILLUSTRATION`
- `NARRATION_GENERATION`
- `PUBLISHING_ASSETS_GENERATION`
- `VIDEO_RENDER`
- `INSTAGRAM_PUBLISH`

Each job stores type, project/version IDs, input snapshot, state, progress step, attempt count, maximum attempts, next attempt time, idempotency key, timestamps, and a sanitized error. Never put secrets in job payloads.

Retry transient network, 5xx, and rate-limit errors with bounded exponential backoff and jitter. Do not automatically retry invalid input, revoked permissions, or unsupported media. For publish timeouts with an uncertain result, reconcile with Instagram before retrying to avoid duplicates.

## 7. Approval gates

- **Storyboard approval:** required before narration and illustration generation. Educator reviews source-linked claims.
- **Final-render approval:** required before scheduling an Instagram post.
- Approvals reference an immutable project version and render asset. Any content edit creates a new version and clears approval for changed content.

## 8. API and error handling

- Prefix routes with `/api/v1` and validate inputs with shared schemas.
- Use `202 Accepted` plus `{jobId, statusUrl}` for asynchronous work.
- Use `Idempotency-Key` for job creation and publish/schedule operations.
- Use `If-Match`/version numbers for concurrent edits.
- Return Problem Details JSON with stable application error codes.
- Log request ID, job ID, provider name/request ID, and elapsed time. Redact tokens, credentials, and sensitive prompts.
- Never send Gemini, ElevenLabs, storage, or Meta credentials to the client.

## 9. Local configuration

Create `.env.example` with variable names only. Keep `.env` ignored by Git.

```dotenv
DATABASE_URL=
DATABASE_SSL=false
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=
OPENAI_IMAGE_MODEL=
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
ASSET_STORAGE_DRIVER=local
ASSET_STORAGE_PATH=./.data/assets
APP_BASE_URL=http://localhost:3000
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
```

The first auth implementation uses PostgreSQL-backed email/password accounts and opaque, randomly generated session cookies. Passwords are stored as scrypt hashes; only SHA-256 hashes of session tokens are stored in PostgreSQL. Run `npm run db:migrate` after setting `DATABASE_URL`. In local development, set up PostgreSQL using the steps in [PROTOTYPE.md](PROTOTYPE.md).

## 10. Operational visibility

Show per-step status and a safe error in the studio. For local development, structured console logs are enough; include request/job IDs so UI progress can be matched to worker logs. Add metrics, tracing, and alerting only when deploying for multiple users.
