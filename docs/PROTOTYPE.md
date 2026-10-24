# First video prototype

The local lesson studio starts from a blank topic field. The primary **Generate video** action takes the topic through source search, lesson/storyboard generation, ElevenLabs narration, and Remotion MP4 rendering in one guided run. The creator can review and edit the storyboard before generating the video. The rendered scenes currently use animated diagrams; the illustration-generation API endpoint is not connected to the studio flow yet.

## Run it locally

1. Install Node.js 20 or newer.
2. Run `npm install` in the project folder.
3. Copy `.env.example` to `.env` and add your Gemini and ElevenLabs credentials. Brave Search is optional; without its key, the video can still be generated, but factual scenes are marked for educator review. Set `ELEVENLABS_DEFAULT_VOICE_ID` to the narrator voice ID. Optionally set up to three curated voice IDs (`ELEVENLABS_VOICE_ID_1` through `_3`) and display names; each voice must be available in your ElevenLabs account.
4. Run `npm run dev` and open the Vite address printed in the terminal.

## Accounts and PostgreSQL

The studio now requires a PostgreSQL database for sign-up, sign-in, and account-owned lessons. For a local database, start Docker Desktop, then run this PowerShell command with a private password of your choice:

```powershell
docker run -d --name little-lessons-postgres --restart unless-stopped -e POSTGRES_USER=little_lessons -e POSTGRES_PASSWORD=YOUR_PRIVATE_PASSWORD -e POSTGRES_DB=little_lessons -p 5432:5432 -v little-lessons-postgres-data:/var/lib/postgresql/data postgres:17-alpine
```

Add `DATABASE_URL=postgresql://little_lessons:YOUR_PRIVATE_PASSWORD@localhost:5432/little_lessons` and `DATABASE_SSL=false` to `.env`, then run `npm run db:migrate` once. Keep `.env` private and out of source control. If a container named `little-lessons-postgres` already exists, reuse it and make sure it is running instead of creating another.

The API reads credentials from the server environment. They are never sent to the browser. Set `GEMINI_TEXT_MODEL` and `ELEVENLABS_MODEL_ID` in `.env` to choose supported models.

## Included

- Editable lesson topic, target audience, 30/45/60-second target, narration, and captions.
- Five-scene starter storyboard with automatic local saving, multiple lesson drafts, and draft switching from the recent drafts list.
- Remotion preview with animated scene diagrams, scene-timed captions, and render progress.
- Gemini storyboard generation, returning five scenes whose durations match the selected target. When configured, Brave Search supplies a short evidence brief with references attached to relevant scenes; without it, factual claims are marked for educator review.
- ElevenLabs voiceover generation with the configured curated voices and friendly, energetic, or calm tone, with character timing used to switch scenes in sync with speech. Generated MP3 files are stored locally under `.data/audio` and can be downloaded from the studio.
- A guided end-to-end generation action and a separate MP4 export action that render the current edited storyboard and synced narration as an H.264 vertical video. Exports are kept under `.data/renders` and can be downloaded from the studio.

## Current prototype limits

The local first-video workflow does not yet connect scene image generation to the studio, include music, use database-backed projects, or support Instagram publishing. Search references can be incomplete or may not support every claim; educators must review each lesson before production. Drafts remain on this device in browser storage and are not synced between browsers or devices. See [ROADMAP.md](ROADMAP.md) for the coverage checklist and implementation order.
