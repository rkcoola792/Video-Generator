# Project progress and next steps

This is the active implementation tracker for the v1 plan in [PRD.md](../PRD.md). We are proceeding in the agreed order: make each user's lessons visible first, then add Instagram review and publishing.

## Completed milestone: My Videos library

- [x] Add an authenticated `GET /api/v1/videos` endpoint that combines each signed-in user's projects with their stored final video assets.
- [x] Keep the library scoped to the current user's owned projects and assets.
- [x] Add a My Videos page with All, Videos Ready, and Drafts filters, title search, finished-video preview, MP4 download, and links back to the studio.
- [x] Keep projects with newer edits visible as drafts alongside their older rendered exports.
- [x] Record newly rendered MP4 asset size and current project version metadata for the library.
- [x] Confirm the signed-in account's live database data appears in the library (four projects loaded).
- [ ] Verify account isolation across multiple users and confirm a completed R2 video appears as a video card.

## Current milestone: review and approval

- [x] Add a review screen to each finished-video card with the selected render preview and MP4 download.
- [x] Let the user edit and save a caption and hashtags for a specific render.
- [x] Require an educational-claims confirmation before approval and bind approval to that render's saved project version.
- [x] Clear prior approval when the user saves changed caption or hashtag text.
- [x] Generate editable caption and hashtag suggestions from the saved lesson (Gemini with OpenAI fallback).
- [x] Add Instagram Login connection, encrypted token storage, and account disconnect.
- [x] Add explicit publish confirmation and asynchronous Reel publishing status.
- [ ] Configure the Meta developer app and verify OAuth with the user's Professional account.
- [ ] Confirm published Reel against the user's live Instagram account and R2 media.

## Next implementation steps

1. **Meta app setup and live publishing verification.** Add credentials, register the exact callback URL, and complete the Meta developer/tester setup for the connected Business or Creator account.
2. **Scheduling and calendar.** Add a durable scheduled-post worker, timezone-aware scheduling, calendar/list views, status updates, and safe retry.

## Other v1 production work

- [ ] Connect scene illustrations to the studio and support per-scene regeneration.
- [ ] Add music beneath narration.
- [x] Add caption/hashtag suggestions; users can edit and save the generated text.
- [ ] Add a custom Reel cover.
- [ ] Add a clear educational-content review gate.
- [ ] Make rendering jobs durable across server restarts.
- [ ] Improve dependency tracking so script, audio, visuals, and exports stay aligned after edits.
- [ ] Complete end-to-end workflow validation before v1 release.

## Existing capabilities

- [x] Accounts and sessions, PostgreSQL-backed projects, and user-scoped project APIs.
- [x] Generate and edit lesson scripts and storyboards; review source links and fact-check flags.
- [x] Generate ElevenLabs narration and render vertical MP4s with Remotion.
- [x] Store media in R2 when configured, with local storage fallback for development.
- [x] Download the finished MP4 and narration audio.

The PRD's complete v1 target remains: create and review a lesson, generate and preview its media, download it, and then approve, schedule, and monitor Instagram publication. Drafts and their assets must stay private to their owner.

## V1 completion target

The prototype becomes v1 when a creator can review source-backed lesson content, edit it, produce and preview narration, scene visuals, captions, music, and a vertical MP4, download it, and—after approving the final render—schedule and monitor its Instagram publication. Unfinished lessons must be resumable without losing their content or generated assets.
