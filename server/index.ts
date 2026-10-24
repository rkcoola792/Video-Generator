import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { Scene } from '../src/video/lesson';
import { clearSessionCookie, hashToken, limitAuthAttempts, loginUser, registerUser, requireAuth, sessionUser } from './auth';
import { requireDatabase } from './database';

const app = express();
app.use(express.json({ limit: '2mb' }));
const renderJobs = new Map<string, { status: 'rendering' | 'complete' | 'failed'; progress: number; error?: string; userId: string; projectId: string }>();
let serveUrlPromise: ReturnType<typeof bundle> | undefined;

const palette = ['#ffc857', '#ff9b71', '#74c6d4', '#8b9fe8', '#92b88c'];
const visuals = ['hook', 'explain', 'scatter', 'explain', 'recap'] as const;
const sceneIds = ['hook', 'sunlight', 'air', 'eyes', 'recap'] as const;
const lessonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          seconds: { type: 'integer' },
          narration: { type: 'string' },
          caption: { type: 'string' },
          visualSteps: { type: 'array', items: { type: 'string' } },
          diagramType: { type: 'string' },
          sourceIndices: { type: 'array', items: { type: 'integer' } },
          needsFactCheck: { type: 'boolean' },
        },
        required: ['label', 'seconds', 'narration', 'caption', 'visualSteps', 'diagramType', 'sourceIndices', 'needsFactCheck'],
      },
    },
  },
  required: ['title', 'scenes'],
};
const openAiLessonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          seconds: { type: 'integer' },
          narration: { type: 'string' },
          caption: { type: 'string' },
          visualSteps: { type: 'array', items: { type: 'string' } },
          diagramType: { type: 'string', enum: ['right-triangle', 'flow', 'cycle', 'comparison', 'cause-effect'] },
          sourceIndices: { type: 'array', items: { type: 'integer' } },
          needsFactCheck: { type: 'boolean' },
        },
        required: ['label', 'seconds', 'narration', 'caption', 'visualSteps', 'diagramType', 'sourceIndices', 'needsFactCheck'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'scenes'],
  additionalProperties: false,
};
type LessonDraft = {
  title: string;
  scenes: Array<{
    label: string;
    seconds: number;
    narration: string;
    caption: string;
    visualSteps: string[];
    diagramType: Scene['diagramType'];
    sourceIndices: number[];
    needsFactCheck: boolean;
  }>;
};

function parseLessonDraft(text: string, provider: string, targetDurationSeconds: number, sources: Array<{ index: number }>): LessonDraft {
  const draft = JSON.parse(text) as LessonDraft;
  const validDiagramTypes = ['right-triangle', 'flow', 'cycle', 'comparison', 'cause-effect'];
  if (!draft.title || !Array.isArray(draft.scenes) || draft.scenes.length !== 5 || draft.scenes.some(scene => !scene.label || !scene.narration || !scene.caption || !Array.isArray(scene.visualSteps) || scene.visualSteps.length !== 3 || scene.visualSteps.some(step => typeof step !== 'string' || step.trim().length < 2 || step.trim().length > 48) || !validDiagramTypes.includes(scene.diagramType ?? '') || !Number.isInteger(scene.seconds) || scene.seconds < 1 || !Array.isArray(scene.sourceIndices) || scene.sourceIndices.some(index => !Number.isInteger(index) || !sources.some(source => source.index === index)) || typeof scene.needsFactCheck !== 'boolean') || draft.scenes.reduce((sum, scene) => sum + scene.seconds, 0) !== targetDurationSeconds) {
    throw new Error(`${provider} returned a storyboard that did not match the required five-scene timing.`);
  }
  return draft;
}

app.get('/api/status', (_request, response) => response.json({ geminiConfigured: Boolean(process.env.GEMINI_API_KEY) }));

app.post('/api/v1/auth/register', limitAuthAttempts, async (request, response) => {
  try {
    const result = await registerUser(request.body ?? {}, response);
    return response.status(result.status).json(result.body);
  } catch (error) {
    console.error('Account registration failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not create your account. Check database setup and try again.' });
  }
});

app.post('/api/v1/auth/login', limitAuthAttempts, async (request, response) => {
  try {
    const result = await loginUser(request.body ?? {}, response);
    return response.status(result.status).json(result.body);
  } catch (error) {
    console.error('Account login failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Sign in is temporarily unavailable. Check database setup and try again.' });
  }
});

app.get('/api/v1/auth/session', requireAuth, (request, response) => response.json({ user: sessionUser(request) }));
app.post('/api/v1/auth/logout', requireAuth, async (request, response) => {
  const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('little_lessons_session='));
  if (cookie) {
    const token = decodeURIComponent(cookie.slice('little_lessons_session='.length));
    await requireDatabase().query('DELETE FROM app_session WHERE token_hash = $1', [hashToken(token)]);
  }
  clearSessionCookie(response);
  return response.json({ ok: true });
});

app.use('/api', requireAuth);

app.get('/api/v1/projects', async (request, response) => {
  try {
    const result = await requireDatabase().query(
      `SELECT p.id, p.title, p.topic, p.audience, p.target_duration_seconds AS "targetDuration",
              p.updated_at AS "updatedAt", v.storyboard_metadata AS draft
       FROM project p LEFT JOIN project_version v ON v.project_id = p.id AND v.is_current = TRUE
       WHERE p.owner_id = $1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`, [request.user!.id],
    );
    return response.json({ projects: result.rows.map(row => row.draft && Object.keys(row.draft).length ? row.draft : {
      id: row.id, topic: row.topic, audience: ({ KIDS: 'Kids', TEENS: 'Teens', ADULT_BEGINNERS: 'Adult beginners' } as Record<string, string>)[row.audience] ?? 'Kids',
      targetDuration: row.targetDuration, tone: 'friendly', voiceId: '', scenes: [], voiceover: null, updatedAt: new Date(row.updatedAt).getTime(),
    }) });
  } catch (error) {
    console.error('Project list failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not load your lessons. Check database setup and try again.' });
  }
});

app.put('/api/v1/projects', async (request, response) => {
  const projects = request.body?.projects;
  if (!Array.isArray(projects) || projects.length > 100) return response.status(400).json({ error: 'Send a valid list of up to 100 projects.' });
  const userId = request.user!.id;
  const audienceValues: Record<string, string> = { Kids: 'KIDS', Teens: 'TEENS', 'Adult beginners': 'ADULT_BEGINNERS' };
  const db = requireDatabase();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    for (const draft of projects) {
      if (!draft || typeof draft.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(draft.id)
        || typeof draft.topic !== 'string' || draft.topic.length > 500
        || !audienceValues[draft.audience] || ![30, 45, 60].includes(draft.targetDuration)
        || !Array.isArray(draft.scenes) || draft.scenes.length > 10) {
        await client.query('ROLLBACK');
        return response.status(400).json({ error: 'A lesson has invalid details. Refresh the page and try again.' });
      }
      const title = draft.topic.trim().slice(0, 200) || 'Untitled lesson';
      await client.query(
        `INSERT INTO project (id, owner_id, title, topic, audience, target_duration_seconds)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [draft.id, userId, title, draft.topic, audienceValues[draft.audience], draft.targetDuration],
      );
      const owned = await client.query('SELECT owner_id FROM project WHERE id = $1 FOR UPDATE', [draft.id]);
      if (!owned.rowCount || owned.rows[0].owner_id !== userId) {
        await client.query('ROLLBACK');
        return response.status(404).json({ error: 'Lesson not found.' });
      }
      const current = await client.query(
        `SELECT version_number, storyboard_metadata FROM project_version
         WHERE project_id = $1 AND is_current = TRUE FOR UPDATE`, [draft.id],
      );
      const encodedDraft = JSON.stringify(draft);
      if (!current.rowCount || canonicalJson(current.rows[0].storyboard_metadata) !== canonicalJson(draft)) {
        const version = (current.rows[0]?.version_number ?? 0) + 1;
        await client.query('UPDATE project_version SET is_current = FALSE WHERE project_id = $1 AND is_current = TRUE', [draft.id]);
        await client.query(
          `INSERT INTO project_version (project_id, version_number, script, storyboard_metadata, created_by)
           VALUES ($1, $2, '{}'::jsonb, $3::jsonb, $4)`, [draft.id, version, encodedDraft, userId],
        );
      }
      await client.query(
        `UPDATE project SET title = $2, topic = $3, audience = $4, target_duration_seconds = $5, updated_at = now()
         WHERE id = $1 AND owner_id = $6`, [draft.id, title, draft.topic, audienceValues[draft.audience], draft.targetDuration, userId],
      );
    }
    await client.query('COMMIT');
    return response.json({ saved: projects.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Project save failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not save your lessons. Your changes will retry automatically.' });
  } finally { client.release(); }
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function curatedVoices() {
  const configured = [
    { voiceId: process.env.ELEVENLABS_VOICE_ID_1, name: process.env.ELEVENLABS_VOICE_NAME_1 || 'Warm storyteller' },
    { voiceId: process.env.ELEVENLABS_VOICE_ID_2, name: process.env.ELEVENLABS_VOICE_NAME_2 || 'Bright guide' },
    { voiceId: process.env.ELEVENLABS_VOICE_ID_3, name: process.env.ELEVENLABS_VOICE_NAME_3 || 'Calm narrator' },
  ].filter((voice): voice is { voiceId: string; name: string } => Boolean(voice.voiceId));
  const defaultVoiceId = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (defaultVoiceId && !configured.some(voice => voice.voiceId === defaultVoiceId)) configured.unshift({ voiceId: defaultVoiceId, name: 'Studio voice' });
  return configured;
}

app.get('/api/voices', (_request, response) => response.json({ voices: curatedVoices() }));

app.get('/api/render-video/:renderId', async (request, response) => {
  const id = request.params.renderId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(404).end();
  const job = renderJobs.get(id);
  if (job && job.userId !== request.user!.id) return response.status(404).json({ error: 'Render not found.' });
  if (!job) {
    const ownedAsset = await requireDatabase().query(
      `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.storage_key = $1 AND p.owner_id = $2`, [`renders/${id}.mp4`, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).json({ error: 'Render not found.' });
    return response.json({ status: 'complete', progress: 1, downloadUrl: `/api/render-video/${id}/download` });
  }
  if (job.status === 'complete') {
    try {
      await stat(resolve('.data', 'renders', `${id}.mp4`));
      return response.json({ ...job, downloadUrl: `/api/render-video/${id}/download` });
    } catch { /* Report the in-memory job state if its file was removed. */ }
  }
  return response.json(job);
});

app.get('/api/render-video/:renderId/download', async (request, response) => {
  const id = request.params.renderId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(404).end();
  try {
    const ownedAsset = await requireDatabase().query(
      `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.storage_key = $1 AND p.owner_id = $2`, [`renders/${id}.mp4`, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).end();
    const filepath = resolve('.data', 'renders', `${id}.mp4`);
    await stat(filepath);
    response.download(filepath, 'little-lessons.mp4');
  } catch { response.status(404).end(); }
});

app.post('/api/render-video', async (request, response) => {
  const { scenes, title, audioId, sceneTimings, audioDurationSeconds, projectId } = request.body ?? {};
  const validScene = (scene: Scene) => scene && typeof scene.id === 'string' && typeof scene.label === 'string'
    && Number.isFinite(scene.seconds) && scene.seconds > 0 && typeof scene.narration === 'string'
    && typeof scene.caption === 'string' && ['hook', 'explain', 'scatter', 'recap'].includes(scene.visual)
    && /^#[0-9a-f]{6}$/i.test(scene.accent);
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 10 || !scenes.every(validScene)
    || typeof title !== 'string' || !title.trim() || title.length > 200 || typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    return response.status(400).json({ error: 'Check the lesson title and storyboard before exporting.' });
  }
  const projectAccess = await requireDatabase().query('SELECT id FROM project WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL', [projectId, request.user!.id]);
  if (!projectAccess.rowCount) return response.status(404).json({ error: 'Lesson not found.' });
  if (audioId) {
    const audioAccess = await requireDatabase().query(
      `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.storage_key = $1 AND p.owner_id = $2`, [`audio/${audioId}.mp3`, request.user!.id],
    );
    if (!audioAccess.rowCount) return response.status(404).json({ error: 'Narration file not found.' });
  }
  if (audioId !== undefined && (typeof audioId !== 'string' || !/^[0-9a-f-]{36}$/i.test(audioId))) {
    return response.status(400).json({ error: 'The narration asset is not valid. Generate the voiceover again.' });
  }
  const timings = Array.isArray(sceneTimings) && sceneTimings.length === scenes.length
    && sceneTimings.every((timing) => typeof timing.sceneId === 'string' && Number.isFinite(timing.startSeconds) && Number.isFinite(timing.endSeconds))
    ? sceneTimings : undefined;
  const duration = Number.isFinite(audioDurationSeconds) ? Math.min(Math.max(audioDurationSeconds, 0), 600) : 0;
  const renderId = randomUUID();
  renderJobs.set(renderId, { status: 'rendering', progress: 0, userId: request.user!.id, projectId });
  response.status(202).json({ renderId });

  void (async () => {
    try {
      const renderFolder = resolve('.data', 'renders');
      await mkdir(renderFolder, { recursive: true });
      serveUrlPromise ??= bundle({ entryPoint: resolve('src/remotion/index.ts') });
      const serveUrl = await serveUrlPromise;
      const inputProps = {
        scenes, title: title.trim(),
        audioSrc: audioId ? `data:audio/mpeg;base64,${(await readFile(resolve('.data', 'audio', `${audioId}.mp3`))).toString('base64')}` : undefined,
        audioDurationSeconds: duration,
        sceneTimings: timings,
      };
      const composition = await selectComposition({ serveUrl, id: 'LessonVideo', inputProps });
      await renderMedia({
        composition, serveUrl, codec: 'h264', outputLocation: resolve(renderFolder, `${renderId}.mp4`),
        inputProps, onProgress: ({ progress }) => { renderJobs.set(renderId, { status: 'rendering', progress, userId: request.user!.id, projectId }); },
      });
      await requireDatabase().query(
        `INSERT INTO asset (project_id, asset_type, storage_key, media_type, provider)
         VALUES ($1, 'FINAL_VIDEO', $2, 'video/mp4', 'REMOTION')`, [projectId, `renders/${renderId}.mp4`],
      );
      renderJobs.set(renderId, { status: 'complete', progress: 1, userId: request.user!.id, projectId });
    } catch (error) {
      console.error('Local MP4 export failed:', error instanceof Error ? error.message : 'Unknown rendering error');
      renderJobs.set(renderId, { status: 'failed', progress: 0, userId: request.user!.id, projectId, error: error instanceof Error ? `MP4 render failed: ${error.message.slice(0, 300)}` : 'MP4 render failed with an unknown error.' });
    }
  })();
});

app.get('/api/audio/:assetId', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) {
    response.status(404).end();
    return;
  }
  try {
    const ownedAsset = await requireDatabase().query(
      `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.storage_key = $1 AND a.asset_type = 'NARRATION_AUDIO' AND p.owner_id = $2`, [`audio/${request.params.assetId}.mp3`, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).end();
    const audio = await readFile(resolve('.data', 'audio', `${request.params.assetId}.mp3`));
    response.type('audio/mpeg').send(audio);
  } catch {
    response.status(404).end();
  }
});

app.get('/api/images/:assetId', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  const ownedImage = await requireDatabase().query(
    `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id
     WHERE a.storage_key LIKE $1 AND a.asset_type = 'SCENE_ILLUSTRATION' AND p.owner_id = $2`, [`images/${request.params.assetId}.%`, request.user!.id],
  );
  if (!ownedImage.rowCount) return response.status(404).end();
  const folder = resolve('.data', 'images');
  for (const [extension, mimeType] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    try {
      const image = await readFile(resolve(folder, `${request.params.assetId}.${extension}`));
      return response.type(mimeType).set('Cache-Control', 'private, max-age=31536000, immutable').send(image);
    } catch { /* Try the other supported image format. */ }
  }
  return response.status(404).end();
});

app.post('/api/generate-illustrations', async (request, response) => {
  const { scenes, scene, title = 'Educational lesson', projectId } = request.body ?? {};
  if (typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) return response.status(400).json({ error: 'Save this lesson before generating illustrations.' });
  const projectAccess = await requireDatabase().query('SELECT id FROM project WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL', [projectId, request.user!.id]);
  if (!projectAccess.rowCount) return response.status(404).json({ error: 'Lesson not found.' });
  const inputScenes = Array.isArray(scenes) ? scenes : scene ? [scene] : [];
  if (inputScenes.length < 1 || inputScenes.length > 10 || inputScenes.some((item: { id?: unknown; label?: unknown; narration?: unknown; caption?: unknown }) => typeof item?.id !== 'string' || typeof item?.label !== 'string' || typeof item?.narration !== 'string' || typeof item?.caption !== 'string')) {
    return response.status(400).json({ error: 'Generate the lesson scenes before creating illustrations.' });
  }
  if (!process.env.GEMINI_API_KEY) return response.status(503).json({ error: 'Gemini is not configured for illustration generation.' });
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const imageFolder = resolve('.data', 'images');
    await mkdir(imageFolder, { recursive: true });
    const illustratedScenes: Scene[] = [];
    for (const scene of inputScenes as Scene[]) {
      const prompt = `Create one polished, topic-accurate educational illustration for a vertical short video. Lesson topic: ${String(title).slice(0, 200)}. Scene: ${scene.label}. Scene narration: ${scene.narration}. On-screen idea: ${scene.caption}. Show a clear visual metaphor, diagram, object, or action that matches this exact lesson scene. Style: hand-drawn playful editorial doodle, warm parchment paper background, forest-green ink outlines, soft sage and amber accents, simple shapes, charming and precise, suitable for an educational short. Center the main illustration with generous negative space around it. Do not add words, letters, numbers, captions, borders, watermarks, or unrelated objects.`;
      const result = await ai.models.generateContent({
        model: process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image',
        contents: prompt,
        config: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '9:16', imageSize: '512' } },
      });
      const imagePart = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data);
      if (!imagePart?.inlineData?.data) throw new Error(`Gemini did not return an illustration for “${scene.label}”.`);
      const assetId = randomUUID();
      const extension = imagePart.inlineData.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      await writeFile(resolve(imageFolder, `${assetId}.${extension}`), Buffer.from(imagePart.inlineData.data, 'base64'));
      await requireDatabase().query(
        `INSERT INTO asset (project_id, asset_type, storage_key, media_type, provider, provider_model)
         VALUES ($1, 'SCENE_ILLUSTRATION', $2, $3, 'GEMINI', $4)`,
        [projectId, `images/${assetId}.${extension}`, extension === 'jpg' ? 'image/jpeg' : 'image/png', process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'],
      );
      illustratedScenes.push({ ...scene, imageUrl: `http://127.0.0.1:${port}/api/images/${assetId}` });
    }
    return response.json(Array.isArray(scenes) ? { scenes: illustratedScenes } : { scene: illustratedScenes[0] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    const quotaOrBilling = /billing|quota|RESOURCE_EXHAUSTED|rate.?limit|paid tier|free tier|429/i.test(detail);
    const badKey = /API_KEY_INVALID|API key not valid|unauthorized/i.test(detail);
    console.error('Gemini illustration generation failed:', detail);
    return response.status(quotaOrBilling ? 402 : badKey ? 401 : 502).json({
      error: quotaOrBilling
        ? 'Gemini image generation is unavailable on the current API tier or quota. The lesson can still be rendered with animated diagrams; enable Gemini image billing only if you want custom illustrations.'
        : badKey
          ? 'Google rejected the Gemini API key. Check that the key is active and can access the configured image model.'
          : `Could not generate the illustration. ${detail.slice(0, 240)}`,
    });
  }
});

app.post('/api/generate-narration', async (request, response) => {
  const { scenes, tone = 'friendly', voiceId: requestedVoiceId, projectId } = request.body ?? {};
  if (typeof projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(projectId)) return response.status(400).json({ error: 'Save this lesson before generating its narration.' });
  const projectAccess = await requireDatabase().query('SELECT id FROM project WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL', [projectId, request.user!.id]);
  if (!projectAccess.rowCount) return response.status(404).json({ error: 'Lesson not found.' });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = typeof requestedVoiceId === 'string' ? requestedVoiceId : process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  if (!apiKey) {
    response.status(503).json({ error: 'Add ELEVENLABS_API_KEY to the active project .env file and restart the app.' });
    return;
  }
  if (!voiceId) {
    response.status(503).json({ error: 'Add ELEVENLABS_DEFAULT_VOICE_ID to the active project .env file and restart the app.' });
    return;
  }
  if (!curatedVoices().some(voice => voice.voiceId === voiceId)) {
    response.status(400).json({ error: 'Choose a narrator from the configured voice list.' });
    return;
  }
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 10 || scenes.some((scene: { narration?: unknown }) => typeof scene?.narration !== 'string' || !scene.narration.trim())) {
    response.status(400).json({ error: 'The storyboard needs narration text in every scene.' });
    return;
  }
  if (!['friendly', 'energetic', 'calm'].includes(tone)) {
    response.status(400).json({ error: 'Choose a supported narration tone.' });
    return;
  }

  const narrationLines = scenes.map((scene: { narration: string }) => scene.narration.trim());
  const script = narrationLines.join('\n\n');
  if (script.length > 10000) {
    response.status(400).json({ error: 'This prototype supports up to 10,000 narration characters per voiceover.' });
    return;
  }
  const settings = {
    friendly: { stability: 0.48, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true, speed: 1 },
    energetic: { stability: 0.35, similarity_boost: 0.75, style: 0.4, use_speaker_boost: true, speed: 1.03 },
    calm: { stability: 0.66, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true, speed: 0.94 },
  }[tone as 'friendly' | 'energetic' | 'calm'];

  try {
    const query = new URLSearchParams({ output_format: 'mp3_44100_128' });
    const ttsResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?${query}`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: script,
        model_id: process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2',
        voice_settings: settings,
      }),
    });
    if (!ttsResponse.ok) {
      const detail = await ttsResponse.text();
      console.error(`ElevenLabs narration failed (${ttsResponse.status}):`, detail.slice(0, 400));
      let providerCode = '';
      try { providerCode = (JSON.parse(detail) as { detail?: { code?: string } }).detail?.code ?? ''; } catch { /* Keep a generic provider error. */ }
      const libraryVoicePlanError = providerCode === 'paid_plan_required';
      const missingPermission = providerCode === 'missing_permissions';
      response.status(libraryVoicePlanError ? 402 : missingPermission ? 401 : ttsResponse.status === 403 ? 403 : 502).json({
        error: libraryVoicePlanError
          ? 'This ElevenLabs library voice is not available through the API on the Free plan. Upgrade the account or use a voice that is available for API generation.'
          : missingPermission
            ? 'The ElevenLabs API key needs the text_to_speech permission enabled.'
            : ttsResponse.status === 401 || ttsResponse.status === 403
              ? 'ElevenLabs rejected the API key or voice access. Check the key and that this voice is available in the account.'
              : `ElevenLabs could not generate this voiceover (HTTP ${ttsResponse.status}). Check the voice ID, model access, and account quota.`,
      });
      return;
    }
    const generated = await ttsResponse.json() as {
      audio_base64?: string;
      alignment?: { character_start_times_seconds?: number[]; character_end_times_seconds?: number[] } | null;
    };
    if (!generated.audio_base64 || !generated.alignment?.character_start_times_seconds || !generated.alignment.character_end_times_seconds) {
      throw new Error('ElevenLabs returned audio without character timing data.');
    }

    let cursor = 0;
    const sceneTimings = narrationLines.map((line: string, index: number) => {
      const textStart = script.indexOf(line, cursor);
      const textEnd = textStart + line.length - 1;
      if (textStart < 0) throw new Error(`Could not align narration scene ${index + 1}.`);
      const startSeconds = generated.alignment!.character_start_times_seconds![textStart];
      const endSeconds = generated.alignment!.character_end_times_seconds![textEnd];
      if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds)) throw new Error(`ElevenLabs returned incomplete timing for scene ${index + 1}.`);
      cursor = textStart + line.length;
      return { sceneId: scenes[index].id, startSeconds, endSeconds };
    });

    const audioId = randomUUID();
    const audioFolder = resolve('.data', 'audio');
    await mkdir(audioFolder, { recursive: true });
    await writeFile(resolve(audioFolder, `${audioId}.mp3`), Buffer.from(generated.audio_base64, 'base64'));
    await requireDatabase().query(
      `INSERT INTO asset (project_id, asset_type, storage_key, media_type, provider, provider_model, generation_metadata)
       VALUES ($1, 'NARRATION_AUDIO', $2, 'audio/mpeg', 'ELEVENLABS', $3, $4::jsonb)`,
      [projectId, `audio/${audioId}.mp3`, process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2', JSON.stringify({ voiceId, tone })],
    );
    const durationSeconds = Math.max(...sceneTimings.map((timing: { endSeconds: number }) => timing.endSeconds));
    response.json({ audioUrl: `/api/audio/${audioId}`, durationSeconds, sceneTimings, voiceId, tone });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    console.error('ElevenLabs narration failed:', detail || 'Unknown error');
    response.status(502).json({ error: detail.includes('timing') || detail.includes('align')
      ? detail
      : 'The voiceover could not be generated. Check the ElevenLabs key, voice ID, and account quota, then try again.' });
  }
});

app.post('/api/generate-lesson', async (request, response) => {
  const { topic, audience, targetDurationSeconds } = request.body ?? {};
  if (typeof topic !== 'string' || topic.trim().length < 3 || topic.length > 500) {
    response.status(400).json({ error: 'Add a topic between 3 and 500 characters.' });
    return;
  }
  if (!['Kids', 'Teens', 'Adult beginners'].includes(audience)) {
    response.status(400).json({ error: 'Choose a supported learner audience.' });
    return;
  }
  if (![30, 45, 60].includes(targetDurationSeconds)) {
    response.status(400).json({ error: 'Choose 30, 45, or 60 seconds.' });
    return;
  }
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) {
    response.status(503).json({ error: 'Add GEMINI_API_KEY or OPENAI_API_KEY to your local .env file, then restart the app.' });
    return;
  }
  const model = process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash';
  const openAiModel = process.env.OPENAI_TEXT_MODEL || 'gpt-6-astra';
  let selectedProvider: 'Gemini' | 'OpenAI' | null = null;
  try {
    let sources: Array<{ index: number; title: string; url: string; excerpt: string }> = [];
    if (process.env.BRAVE_SEARCH_API_KEY) {
      const searchUrl = new URL('https://api.search.brave.com/res/v1/web/search');
      searchUrl.searchParams.set('q', `${topic.trim()} educational scientific facts reliable sources`);
      searchUrl.searchParams.set('count', '8');
      searchUrl.searchParams.set('country', 'IN');
      searchUrl.searchParams.set('search_lang', 'en');
      const searchResponse = await fetch(searchUrl, { headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' } });
      if (!searchResponse.ok) {
        console.error(`Brave Search failed (${searchResponse.status}).`);
        response.status(502).json({ error: 'Source search could not complete. Check the Brave Search API key and try again.' });
        return;
      }
      const searchData = await searchResponse.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
      sources = (searchData.web?.results ?? []).flatMap((result, index) => {
        if (!result.title || !result.url || !/^https?:\/\//i.test(result.url)) return [];
        return [{ index, title: result.title, url: result.url, excerpt: result.description ?? '' }];
      }).filter((source, index, list) => list.findIndex(candidate => candidate.url === source.url) === index).slice(0, 8);
    }
    const evidenceBrief = sources.length
      ? sources.map(source => `[${source.index}] ${source.title}\n${source.excerpt}\n${source.url}`).join('\n\n')
      : 'No external references were available. Do not invent references. Mark every scene with an educational factual claim as needing educator fact checking.';
    const lessonPrompt = `Create one short educational video storyboard about: ${topic.trim()}\nAudience: ${audience}.\nTarget duration: exactly ${targetDurationSeconds} seconds.\nReturn exactly 5 scenes: an engaging question hook, a clear explanation, a concrete example or visual, what the learner should notice, and a one-sentence recap. Use warm, accurate, simple language for the audience. Narration should fit the time when spoken aloud. Keep each caption punchy (max 9 words). The five integer scene durations must add up to exactly ${targetDurationSeconds}. Do not include calls to action.\nFor every scene, include exactly 3 visualSteps: short concrete labels (2 to 5 words) for the objects or actions that should appear in sequence, showing how this specific idea works. Avoid vague labels like “Understand it”. Also choose exactly one diagramType from: right-triangle, flow, cycle, comparison, cause-effect. Use right-triangle whenever the topic is the Pythagorean theorem or right-triangle geometry. Use flow for ordered transformations, cycle for repeating processes, comparison for two quantities or alternatives, and cause-effect for mechanisms. The video will animate this diagram, so diagramType must match how the concept works.\n\nUse only this search evidence for factual claims:\n${evidenceBrief}\n\nAvailable references (sourceIndices must use these zero-based indices):\n${JSON.stringify(sources.map(({ index, title, url }) => ({ index, title, url })))}\nFor every scene, set sourceIndices to the relevant references from this list. Do not invent references. Set needsFactCheck true when a factual claim is not clearly supported by an available reference, or when the scene contains a claim that should receive educator review. Creative hooks with no factual assertion may use an empty sourceIndices list and needsFactCheck false.`;
    let draft: LessonDraft | undefined;
    let geminiFailure: unknown;
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let lastError: unknown;
        let generatedText: string | undefined;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            const result = await ai.models.generateContent({
              model,
              contents: lessonPrompt,
              config: { responseMimeType: 'application/json', responseJsonSchema: lessonSchema },
            });
            generatedText = result.text;
            break;
          } catch (error) {
            lastError = error;
            const detail = error instanceof Error ? error.message : '';
            const temporarilyBusy = /currently experiencing high demand|UNAVAILABLE|RESOURCE_EXHAUSTED|429|503/i.test(detail);
            if (!temporarilyBusy || attempt === 2) throw error;
            const delayMs = 1200 * (attempt + 1);
            console.warn(`Gemini lesson request busy; retrying in ${delayMs}ms (attempt ${attempt + 2}/3).`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        }
        if (!generatedText) throw lastError ?? new Error('Gemini returned an empty response.');
        draft = parseLessonDraft(generatedText, 'Gemini', targetDurationSeconds, sources);
        selectedProvider = 'Gemini';
      } catch (error) {
        geminiFailure = error;
        if (!process.env.OPENAI_API_KEY) throw error;
        console.warn('Gemini lesson generation failed; trying the OpenAI fallback.');
      }
    }
    if (!draft && process.env.OPENAI_API_KEY) {
      selectedProvider = 'OpenAI';
      const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: openAiModel,
          input: [
            { role: 'system', content: 'Create accurate, age-appropriate educational video storyboards. Follow the supplied requirements and evidence. Return only the requested structured result.' },
            { role: 'user', content: lessonPrompt },
          ],
          text: { format: { type: 'json_schema', name: 'lesson_draft', strict: true, schema: openAiLessonSchema } },
        }),
      });
      const openAiPayload = await openAiResponse.json() as {
        error?: { message?: string };
        output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      };
      if (!openAiResponse.ok) throw new Error(openAiPayload.error?.message || `OpenAI returned HTTP ${openAiResponse.status}.`);
      const generatedText = openAiPayload.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text;
      if (!generatedText) throw new Error('OpenAI returned an empty response.');
      draft = parseLessonDraft(generatedText, 'OpenAI', targetDurationSeconds, sources);
      if (geminiFailure) console.info('OpenAI generated the lesson after Gemini was unavailable.');
    }
    if (!draft || !selectedProvider) throw new Error('No lesson generation provider was available.');
    response.json({
      title: draft.title,
      scenes: draft.scenes.map((scene, index) => ({ ...scene, sources: scene.sourceIndices.map(sourceIndex => sources.find(source => source.index === sourceIndex)).filter((source): source is { index: number; title: string; url: string; excerpt: string } => Boolean(source)).map(({ title, url }) => ({ title, url })), id: sceneIds[index], visual: visuals[index], accent: palette[index] })),
      reviewNote: `${selectedProvider === 'OpenAI' && geminiFailure ? 'Gemini was unavailable, so OpenAI generated this draft. ' : ''}${sources.length ? 'Search references are attached where relevant. Review every educational claim before production.' : 'Video created without source search. All factual claims need educator review.'}`,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : '';
    if (selectedProvider === 'OpenAI') {
      const invalidKey = /401|invalid_api_key|incorrect api key/i.test(detail);
      console.error('OpenAI lesson fallback failed:', invalidKey ? 'API key rejected' : detail || 'Unknown error');
      response.status(invalidKey ? 401 : 502).json({ error: invalidKey
        ? 'OpenAI rejected this API key. Check OPENAI_API_KEY in .env and restart the app.'
        : 'Gemini was unavailable and OpenAI could not create the lesson. Check OPENAI_API_KEY, OPENAI_TEXT_MODEL, and your OpenAI API access, then try again.' });
      return;
    }
    const invalidKey = /API_KEY_INVALID|API key not valid/i.test(detail);
    const busy = /currently experiencing high demand|UNAVAILABLE/i.test(detail);
    console.error('Gemini lesson generation failed:', invalidKey ? 'API key rejected' : busy ? 'Model temporarily unavailable' : detail || 'Unknown error');
    response.status(invalidKey ? 401 : 502).json({
      error: invalidKey
        ? 'Google rejected this Gemini API key. Replace GEMINI_API_KEY in .env with an active key from Google AI Studio, then restart the app.'
        : busy
          ? 'Gemini is experiencing high demand. Add OPENAI_API_KEY to .env to enable automatic fallback, or try again in a little while.'
          : /responseJsonSchema|schema|INVALID_ARGUMENT/i.test(detail)
            ? 'Gemini rejected the lesson response format. Check the configured lesson schema and try again.'
            : /model.*(not found|unsupported|not supported)|404/i.test(detail)
              ? `Gemini could not find the configured text model “${model}”. Update GEMINI_TEXT_MODEL in .env and restart the app.`
              : 'Gemini could not create the lesson. Check the API key, model access, and server log, then try again.',
    });
  }
});

const port = Number(process.env.PORT || 4174);
app.listen(port, '127.0.0.1', () => console.log(`Lesson API listening on http://127.0.0.1:${port}`));
