# Project progress and next steps

This checklist compares the current local prototype with the v1 plan in [PRD.md](../PRD.md). “Covered” means the feature is present in the app; “partial” means a useful first version exists but does not meet the full v1 workflow yet.

## Covered in the prototype

- [x] React studio with topic, learner audience, target duration, storyboard editor, and Remotion preview.
- [x] Generate one five-scene lesson with Gemini; enforce the selected duration and validate the returned scene structure.
- [x] Optional Brave Search evidence with clickable references and educator fact-check flags when evidence is missing or claims need review.
- [x] Edit scene narration and captions, add a scene, and restore the starter storyboard.
- [x] Generate ElevenLabs narration with configured voices and friendly, energetic, or calm tone; use returned timing to align scene changes.
- [x] Render and download a vertical MP4, and download the generated narration audio.
- [x] Keep multiple drafts in browser local storage and switch between them on the same browser/device.
- [x] Keep Gemini and ElevenLabs credentials on the server in environment configuration.

## Partially covered

- [ ] **Scene illustrations:** the server has an endpoint that can generate and store illustrations, but the studio does not call it or show a regenerate-scene control. The current video uses animated diagrams instead.
- [ ] **Captions:** scene captions appear in the video and scene timing follows voice alignment, but there is no word-level caption timing or dedicated caption review workflow.
- [ ] **Draft recovery:** drafts autosave locally, but are not backed up, synced, or versioned and can be lost with browser storage.
- [ ] **Lesson review:** source links and fact-check flags are visible, but there is no explicit storyboard approval gate before narration/rendering.
- [ ] **Rendering jobs:** the UI polls for render progress, but job state and files are local and not durable across restarts or devices.
- [ ] **Content invalidation:** edits clear some generated assets, but there is no explicit immutable version history or reliable dependency tracking for every asset.

## Not implemented yet

- [ ] Background music mixed beneath narration.
- [ ] Reel cover generation and editable Instagram caption/hashtags.
- [ ] Database-backed projects, durable job queue, and shared asset storage.
- [ ] Instagram account connection, approval-gated scheduling, calendar, publishing status, failure alerts, and retry.
- [ ] User-facing progress and recovery for all generation steps, not only MP4 rendering.

## Recommended implementation order

1. **Finish the visual production loop.** Connect the existing illustration endpoint to the studio, store the returned scene image URLs in the active draft, show generated art in the editor/preview, and add per-scene regeneration. Preserve animated diagrams as a fallback if image generation is unavailable.
2. **Make edits and generated assets dependable.** Track which narration, illustration, and render belong to the current storyboard; invalidate only affected outputs when text, voice, tone, or visuals change. Add a clear review/approval step before production.
3. **Add music and publishing assets.** Include a properly licensed bundled music track with a low-volume mix, then generate a Reel cover, caption, and hashtags for user review.
4. **Move drafts and jobs out of the browser/process.** Add persistent project storage and a durable job queue so drafts, assets, progress, failures, and retries survive restarts.
5. **Build Instagram publishing.** Verify current Meta account and media requirements, connect an eligible account, require approval of a specific render, then add scheduling, calendar, status, failure handling, and safe retry.
6. **Polish and validate the complete workflow.** Confirm draft resume, review gates, generated assets, MP4 download, and scheduled-post state end to end before considering v1 complete.

## Best next feature

Start with **Step 1: connect scene illustration generation to the studio**. The backend capability already exists, while the current user flow and video composition do not use it. Completing this will close a visible gap in the core idea-to-video journey before adding persistence or social publishing.

## V1 completion target

The prototype becomes v1 when a creator can review source-backed lesson content, edit it, produce and preview narration, scene visuals, captions, music, and a vertical MP4, download it, and—after approving the final render—schedule and monitor its Instagram publication. Unfinished lessons must be resumable without losing their content or generated assets.
