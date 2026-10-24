# External API Integrations

This is a provider map, not a guarantee of current endpoint availability. Keep model names and platform API versions in configuration and check official documentation before implementation.

## 1. Gemini — script and storyboard

**Chosen:** Gemini API through Google's `@google/genai` JavaScript SDK. Use schema-constrained JSON for the lesson draft and validate it again in application code.

- Authentication: server-side `GEMINI_API_KEY` environment variable. Do not put it in browser code or local storage.
- Configure the text model with `GEMINI_TEXT_MODEL` instead of hard-coding it in domain logic.
- Require schema fields for title, hook, recap, scenes, narration, on-screen text, visual prompts, claims, and source references.
- Validate returned data in the application even when Structured Outputs is enabled; handle refusals and incomplete output separately.

### OpenAI text fallback

The lesson endpoint tries Gemini first, retries temporary Gemini outages, then uses OpenAI Responses with a strict JSON schema if `OPENAI_API_KEY` is configured. OpenAI can also generate lessons by itself when `GEMINI_API_KEY` is absent. Set `OPENAI_TEXT_MODEL` to override the default `gpt-6-astra`. Both providers receive the same evidence brief and their output is validated against the same five-scene timing and field requirements. Keep the key in the server-side `.env` only.

### Source discovery

The local prototype uses Brave Web Search (`BRAVE_SEARCH_API_KEY`) to retrieve result titles, URLs, and snippets before the schema-constrained Gemini storyboard call. The result list is passed into Gemini as evidence; scene references are attached as clickable links and scenes can be flagged for educator review. Search snippets may not prove a claim, so keep the human review step. This provider can be replaced behind a `SourceFinder` adapter.

Official docs: [Brave Web Search API](https://api-dashboard.search.brave.com/app/documentation/web-search), [Brave Web Search reference](https://api-dashboard.search.brave.com/api-reference/web/search/get).

Official docs: [Responses API](https://developers.openai.com/api/reference/responses/overview), [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Web search](https://developers.openai.com/api/docs/guides/tools-web-search).

## 2. Image generation — provider not yet selected

Keep this behind an `IllustrationGenerator` interface. OpenAI is one candidate, but image generation has not been confirmed and should remain independent from the lesson-text provider.

- Candidate endpoint if OpenAI is selected: `POST https://api.openai.com/v1/images/generations`.
- Generate one illustration per scene with a shared style guide, palette, and recurring character description.
- Store image bytes in local/object storage immediately; do not put base64 image content in PostgreSQL.
- Configure `OPENAI_IMAGE_MODEL` only if this provider is selected.
- If serving individual end users, follow OpenAI's current privacy-preserving `safety_identifier` guidance.

Official docs: [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation), [Create image API](https://developers.openai.com/api/reference/resources/images/methods/generate).

## 3. ElevenLabs — narration

**Chosen:** ElevenLabs text-to-speech. V1 offers a small curated voice list and friendly, energetic, and calm tones.

- Endpoint: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/with-timestamps`.
- Authentication: server-side `xi-api-key` header.
- Input: storyboard narration, configured voice ID, model ID, and mapped voice settings for tone.
- Output: MP3 plus character-level alignment; the prototype maps character timing back to each scene and serves the generated audio from local `.data/audio` storage.
- Keep voice IDs and tone mappings in configuration; use one narrator consistently across a video.
- The local prototype reads `ELEVENLABS_API_KEY`, `ELEVENLABS_DEFAULT_VOICE_ID`, and `ELEVENLABS_MODEL_ID` from `.env`.

Official docs: [Text to Speech](https://elevenlabs.io/docs/overview/capabilities/text-to-speech), [API quickstart](https://elevenlabs.io/docs/eleven-api/quickstart/).

## 4. Remotion — composition and rendering

Remotion is an application library, not an external model API.

- Use `@remotion/player` for in-app preview.
- Pass a JSON-serializable project-version snapshot to the composition.
- Use the Remotion renderer in the background worker for final MP4 generation.
- Save output as a versioned asset and report progress through the app job API.

Official docs: [Remotion Player](https://www.remotion.dev/docs/player), [Rendering](https://www.remotion.dev/docs/render), [Components](https://www.remotion.dev/docs/components).

## 5. Instagram — authorization and scheduled publishing

**Chosen product capability:** schedule and automatically publish approved Reels. Exact login flow and Graph API version remain implementation decisions.

- Connect through Meta's supported authorization flow and request only needed permissions.
- Keep access tokens server-side and encrypted at rest; redact them from logs.
- Store schedules in the app database and enqueue a publish job when due.
- Persist each publish step and reconcile uncertain outcomes before retrying to avoid duplicate posts.
- Save caption, hashtags, cover, video asset, platform response ID, and publish status.
- Verify account eligibility, current permissions, Reels parameters, media reachability, token behavior, and app-review requirements before enabling live publishing.
- Keep MP4 download functional when Meta authorization is not configured.

Official references: [Instagram API with Instagram Login](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login), [Content Publishing](https://developers.facebook.com/docs/instagram-platform/content-publishing).

## 6. Background music

No music-generation API is selected. For local development, use a bundled, properly licensed track and mix it quietly under narration. Keep the track as an asset reference so a licensed catalog or generation provider can be added later.

## 7. Local environment variables

```dotenv
GEMINI_API_KEY=
GEMINI_TEXT_MODEL=
BRAVE_SEARCH_API_KEY=
OPENAI_IMAGE_MODEL=
ELEVENLABS_API_KEY=
ELEVENLABS_DEFAULT_VOICE_ID=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
INSTAGRAM_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=
```

Keep `.env` out of version control. Put variable names, not real credentials, in `.env.example`.
