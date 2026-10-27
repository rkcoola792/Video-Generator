# AI Educational Video Maker — PRD

**Status:** In implementation
**Project context:** Personal learning project inspired by a course workflow using AI, ElevenLabs, and Remotion.  
**Version:** 0.1

## 1. Product summary

Turn a user's educational idea into a short, animated lesson. The app helps draft and review the lesson, creates narration and scene visuals, renders a vertical video, and supports scheduling and publishing it to Instagram.

## 2. Problem

Creating an educational short video requires a creator to write a script, plan scenes, find or make visuals, record narration, animate and edit the video, create a cover and post text, and publish it. This project brings those steps into one guided AI-assisted workflow while letting the creator review the educational content and finished video before publishing.

## 3. Intended user

Independent educators who have an educational idea and want to turn it into a short, approachable animated video for Instagram.

The creator can select **kids, teens, or adult beginners** for each lesson, so the explanation's vocabulary and examples can be adapted.

## 4. Product goals

- Help a creator move from a topic to a complete short lesson video.
- Make the video understandable, engaging, and visually consistent.
- Reduce the manual work of narration, animation, captions, and Instagram publishing.
- Keep the creator in control of educational claims and the final publication.
- Provide a useful project for learning AI integration, audio generation, and programmatic video creation.

## 5. V1 user journey

1. **Start a lesson.** Enter a topic or question, choose the intended learner audience/level, and choose a target video length.
2. **Generate a lesson draft.** The AI creates one hook-led script and a scene-by-scene storyboard that ends with a brief recap. It finds references for factual claims and flags claims that may need review.
3. **Review and edit.** Edit the script and storyboard scenes. Regenerate an individual scene illustration if needed without starting the whole video over.
4. **Create narration.** Choose an ElevenLabs voice and narration tone, then generate the approved script's narration.
5. **Create the video.** Generate consistent playful-doodle illustrations for each scene. Remotion assembles animated scenes, narration, synchronized captions, and low-volume background music into a vertical video.
6. **Review the publish assets.** Preview and approve the video. Generate a titled Reel cover, which is used as-is. Draft an Instagram caption and hashtags, which the user can edit.
7. **Download or schedule.** Download the rendered MP4 or schedule it for automatic Instagram publishing after approval. View upcoming posts in a calendar.
8. **Handle publishing issues.** Show scheduled/published/failed status. Alert the user when a scheduled post fails and offer a retry.
9. **Save progress.** Save an unfinished lesson as a draft and resume it later.

## 6. Confirmed v1 requirements

### Lesson planning

- Accept a topic or question as the starting idea.
- Let the creator choose kids, teens, or adult beginners; adapt vocabulary and examples accordingly.
- Let the creator select a 30-, 45-, or 60-second target video length.
- Generate one script and storyboard draft per idea.
- Structure the script with an opening hook and a closing learning recap.
- Find source references for factual claims and flag claims that need checking.
- Do not require users to supply their own links or documents as sources.
- Let the user edit the script and individual storyboard scenes before audio/video generation.

### Audio and video

- Use ElevenLabs for narration generation.
- Allow narrator voice and narration tone selection.
- Offer a small curated list of ElevenLabs narrator voices.
- Offer friendly, energetic, and calm narration tones.
- Generate a custom illustration for each scene in a consistent playful-doodle style.
- Allow an individual scene illustration to be regenerated.
- Use Remotion to animate and render the video.
- Add on-screen captions synchronized to narration.
- Add background music mixed at a low volume beneath narration.
- Render a vertical Instagram-ready MP4 and allow the user to download it.
- Generate a Reel cover image with a clear title; use the generated image as-is without cover editing in v1.
- Let the user preview and approve the final video before publishing.

### Instagram workflow

- Draft a caption and relevant hashtags for each video; allow the user to edit them.
- Allow the user to schedule approved videos for automatic Instagram publishing.
- Show upcoming scheduled videos in a calendar.
- Show post status and alert the user about publishing failures with an option to retry.
- Require user approval before a post is scheduled for publication.

### Projects

- Save unfinished work as drafts and allow users to resume it later.

## 7. Out of scope for v1

- Languages other than English.
- User-uploaded or user-provided source links/documents.
- Multiple alternative scripts/storyboards for one idea.
- Calls to action such as “follow for more” or “save this” in the lesson video.
- A quiz or knowledge-check after the lesson recap.
- Instagram performance analytics such as views, likes, comments, and saves.
- Editing the generated cover image.
- Additional publishing platforms beyond Instagram.

## 8. Success criteria

V1 is successful when a user can take an idea through the full workflow and:

- Review source-backed script/storyboard content and edit it before production.
- Generate and preview narration, illustrations, captions, music, and animation together.
- Download the final vertical MP4.
- Approve, schedule, and monitor an Instagram post from the app.
- Save and resume a draft without losing its script, storyboard, or generated assets.

## 9. Learning stack direction

### Chosen tools

- **Gemini API:** Google GenAI SDK with schema-validated output for script/storyboard generation. Keep the API key on the server.
- **ElevenLabs:** text-to-speech narration.
- **Remotion:** React-based scene animation, composition, preview, and video rendering.

### To choose during implementation

- Image generation provider for playful-doodle scene illustrations and Reel covers.
- Persistent storage for projects, generated assets, and publishing jobs.
- Instagram authorization and publishing integration.
- Hosting platform for a later deployment.

## 10. Open product decisions

- Which specific ElevenLabs voices should be in the curated starter list?
- What should happen when an AI-found source is unavailable or a claim cannot be verified?
- What is the expected publishing account setup and Instagram integration path?

## 11. Risks and dependencies

- Educational claims need clear references and human review; generated text may be wrong even when it sounds confident.
- Consistent custom illustrations and accurate scene-to-script alignment are important to lesson quality.
- Video generation, voice generation, image generation, and reference retrieval depend on external model APIs and may have cost, latency, and rate limits.
- Instagram publishing depends on Meta account authorization and current platform requirements; verify those details when implementing the integration.
- A publishing failure must not silently appear successful; show status and make retry possible.

## 12. Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the recommended application structure, generation workflow, data model, and staged implementation plan.

## 13. Implementation tracking

The current build status and agreed next steps are tracked in [docs/ROADMAP.md](docs/ROADMAP.md). The first publishing milestone is the authenticated My Videos library; Instagram review and publishing follow it in sequence.
