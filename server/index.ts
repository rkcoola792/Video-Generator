import 'dotenv/config';
import express from 'express';
import { GoogleGenAI } from '@google/genai';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { Scene } from '../src/video/lesson';
import { clearSessionCookie, hashToken, limitAuthAttempts, loginUser, registerUser, requireAuth, sessionUser } from './auth';
import { requireDatabase } from './database';
import { getInstagramMediaUrl, getPrivateDownload, hasStoredObject, mediaStorageMode, readStoredObject, removeLocalObject, storeBuffer, storeFile } from './media-storage';
import { exchangeInstagramCode, instagramAuthorizationUrl, instagramCallbackUrl, instagramConfigReady, publishInstagramReel } from './instagram';

const app = express();
app.use(express.json({ limit: '2mb' }));
const renderJobs = new Map<string, { status: 'rendering' | 'complete' | 'failed'; progress: number; error?: string; userId: string; projectId: string }>();
let serveUrlPromise: ReturnType<typeof bundle> | undefined;

const windowsChrome = process.platform === 'win32'
  ? [process.env.REMOTION_BROWSER_EXECUTABLE, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find(path => path && existsSync(path))
  : undefined;
const remotionBrowserOptions = windowsChrome
  ? { browserExecutable: windowsChrome, chromeMode: 'chrome-for-testing' as const }
  : {};

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

app.get('/api/status', (_request, response) => response.json({ geminiConfigured: Boolean(process.env.GEMINI_API_KEY), mediaStorage: mediaStorageMode }));

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

// Instagram redirects back on the Meta/Cloudflare hostname, so the app's
// localhost session cookie is not available here. The one-time OAuth state
// record is the callback's authentication and ties the authorization to the
// app user who started it.
app.use('/api', (request, response, next) => {
  if (request.method === 'GET' && request.path === '/v1/social/instagram/callback') return next();
  return requireAuth(request, response, next);
});

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

app.get('/api/v1/videos', async (request, response) => {
  try {
    const result = await requireDatabase().query(
      `SELECT p.id AS "projectId", p.title, p.topic, p.audience,
              p.target_duration_seconds AS "targetDuration", p.updated_at AS "projectUpdatedAt",
              v.storyboard_metadata AS draft,
              a.id AS "assetId", a.storage_key AS "storageKey", a.media_type AS "mediaType",
              COALESCE(av.storyboard_metadata->>'topic', p.topic) AS "assetTitle",
              av.storyboard_metadata->>'audience' AS "assetAudience",
              COALESCE(NULLIF(av.storyboard_metadata->>'targetDuration', '')::INTEGER, p.target_duration_seconds) AS "assetDuration",
              a.byte_size AS "byteSize", a.created_at AS "assetCreatedAt"
       FROM project p
       LEFT JOIN project_version v ON v.project_id = p.id AND v.is_current = TRUE
       LEFT JOIN asset a ON a.project_id = p.id AND a.asset_type = 'FINAL_VIDEO'
       LEFT JOIN project_version av ON av.id = a.project_version_id
       WHERE p.owner_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.updated_at DESC, a.created_at DESC`, [request.user!.id],
    );

    type VideoRow = {
      projectId: string; title: string; topic: string; audience: string; targetDuration: number;
      projectUpdatedAt: Date; draft: Record<string, unknown> | null; assetId: string | null;
      storageKey: string | null; mediaType: string | null; assetTitle: string; assetAudience: string | null;
      assetDuration: number;
      byteSize: string | number | null;
      assetCreatedAt: Date | null;
    };
    const projects = new Map<string, { row: VideoRow; assets: VideoRow[] }>();
    for (const row of result.rows as VideoRow[]) {
      const project = projects.get(row.projectId) ?? { row, assets: [] };
      if (row.assetId && row.storageKey) project.assets.push(row);
      projects.set(row.projectId, project);
    }

    const items: Array<Record<string, unknown>> = [];
    for (const { row, assets } of projects.values()) {
      const availableAssets = (await Promise.all(assets.map(async asset =>
        await hasStoredObject(asset.storageKey!) ? asset : null,
      ))).filter((asset): asset is VideoRow => asset !== null);
      const audience = ({ KIDS: 'Kids', TEENS: 'Teens', ADULT_BEGINNERS: 'Adult beginners' } as Record<string, string>)[row.audience] ?? 'Kids';
      const videoIds = new Set<string>();
      for (const asset of availableAssets) {
        const renderId = asset.storageKey!.match(/^renders\/([0-9a-f-]{36})\.mp4$/i)?.[1] ?? null;
        if (!renderId) continue;
        videoIds.add(renderId);
        items.push({
          id: `video:${asset.assetId}`, kind: 'video', projectId: row.projectId, assetId: asset.assetId,
          title: asset.assetTitle || row.title || 'Untitled lesson',
          audience: ({ KIDS: 'Kids', TEENS: 'Teens', ADULT_BEGINNERS: 'Adult beginners' } as Record<string, string>)[asset.assetAudience ?? ''] ?? asset.assetAudience ?? audience,
          durationSeconds: asset.assetDuration, createdAt: new Date(asset.assetCreatedAt!).toISOString(),
          mediaUrl: `/api/v1/videos/${asset.assetId}/media`,
          downloadUrl: `/api/v1/videos/${asset.assetId}/download`,
        });
      }

      const currentRenderId = typeof row.draft?.renderId === 'string' ? row.draft.renderId : null;
      const latestVideoAt = availableAssets.reduce((latest, asset) => Math.max(latest, new Date(asset.assetCreatedAt!).getTime()), 0);
      const projectUpdatedAt = new Date(row.projectUpdatedAt).getTime();
      const hasCurrentVideo = currentRenderId ? videoIds.has(currentRenderId) : latestVideoAt >= projectUpdatedAt;
      if (!hasCurrentVideo) {
        items.push({
          id: `draft:${row.projectId}`, kind: 'draft', projectId: row.projectId, title: row.topic || row.title || 'Untitled lesson',
          audience, durationSeconds: row.targetDuration, updatedAt: new Date(row.projectUpdatedAt).toISOString(),
        });
      }
    }
    items.sort((a, b) => new Date(String(b.createdAt ?? b.updatedAt)).getTime() - new Date(String(a.createdAt ?? a.updatedAt)).getTime());
    return response.json({ videos: items });
  } catch (error) {
    console.error('Video library failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not load your videos. Check your connection and try again.' });
  }
});

app.get('/api/v1/videos/:assetId/media', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  try {
    const ownedAsset = await requireDatabase().query(
      `SELECT a.storage_key FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).end();
    const delivery = await getPrivateDownload(ownedAsset.rows[0].storage_key);
    if (!delivery) return response.status(404).end();
    if (delivery.kind === 'r2') return response.redirect(delivery.url);
    return response.type('video/mp4').sendFile(delivery.filepath);
  } catch {
    return response.status(404).end();
  }
});

app.get('/api/v1/videos/:assetId/download', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  try {
    const ownedAsset = await requireDatabase().query(
      `SELECT a.storage_key FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).end();
    const delivery = await getPrivateDownload(ownedAsset.rows[0].storage_key, 'little-lessons.mp4');
    if (!delivery) return response.status(404).end();
    if (delivery.kind === 'r2') return response.redirect(delivery.url);
    return response.download(delivery.filepath, 'little-lessons.mp4');
  } catch {
    return response.status(404).end();
  }
});

app.get('/api/v1/videos/:assetId/review', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  try {
    const result = await requireDatabase().query(
      `SELECT a.id AS "assetId", a.storage_key AS "storageKey", a.project_version_id AS "versionId",
              a.created_at AS "createdAt", p.id AS "projectId", p.title,
              COALESCE(av.storyboard_metadata->>'topic', p.topic) AS topic,
              COALESCE(av.storyboard_metadata->>'audience', p.audience) AS audience,
              COALESCE(NULLIF(av.storyboard_metadata->>'targetDuration', '')::INTEGER, p.target_duration_seconds) AS "durationSeconds",
              COALESCE(r.caption, '') AS caption, COALESCE(r.hashtags, ARRAY[]::TEXT[]) AS hashtags,
              r.updated_at AS "reviewUpdatedAt",
              EXISTS (SELECT 1 FROM approval ap WHERE ap.asset_id = a.id AND ap.stage = 'FINAL_RENDER'
                      AND ap.project_version_id = a.project_version_id) AS approved
       FROM asset a
       JOIN project p ON p.id = a.project_id
       LEFT JOIN project_version av ON av.id = a.project_version_id
       LEFT JOIN video_review r ON r.asset_id = a.id AND r.owner_id = $2
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Video not found.' });
    const row = result.rows[0];
    if (!await hasStoredObject(row.storageKey)) return response.status(404).json({ error: 'This video file is no longer available.' });
    const audience = ({ KIDS: 'Kids', TEENS: 'Teens', ADULT_BEGINNERS: 'Adult beginners' } as Record<string, string>)[row.audience] ?? row.audience;
    return response.json({ review: {
      assetId: row.assetId, projectId: row.projectId, title: row.topic || row.title || 'Untitled lesson',
      audience, durationSeconds: row.durationSeconds, caption: row.caption, hashtags: row.hashtags,
      approved: row.approved, canApprove: Boolean(row.versionId),
      approvalNote: row.versionId ? undefined : 'Re-export this video from the studio to link it to a saved lesson version before approving it.',
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: row.reviewUpdatedAt ? new Date(row.reviewUpdatedAt).toISOString() : undefined,
      mediaUrl: `/api/v1/videos/${row.assetId}/media`, downloadUrl: `/api/v1/videos/${row.assetId}/download`,
    } });
  } catch (error) {
    console.error('Video review load failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not load this video review.' });
  }
});

app.put('/api/v1/videos/:assetId/review', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  const { caption, hashtags, approve } = request.body ?? {};
  if (typeof caption !== 'string' || caption.length > 5000 || !Array.isArray(hashtags) || hashtags.length > 50
    || !hashtags.every((tag: unknown) => typeof tag === 'string' && tag.trim().replace(/^#+/, '').length <= 100
      && /^[\p{L}\p{N}_]+$/u.test(tag.trim().replace(/^#+/, ''))) || typeof approve !== 'boolean') {
    return response.status(400).json({ error: 'Add a caption of up to 5,000 characters and valid hashtags, then save again.' });
  }
  const db = requireDatabase();
  const client = await db.connect();
  try {
    const video = await client.query(
      `SELECT a.id, a.project_id, a.project_version_id
       FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!video.rowCount) return response.status(404).json({ error: 'Video not found.' });
    const versionId = video.rows[0].project_version_id as string | null;
    if (approve && !versionId) return response.status(409).json({ error: 'Re-export this video from the studio to link it to a saved lesson version before approving it.' });

    const normalizedHashtags = hashtags.map((tag: string) => tag.trim().replace(/^#+/, '')).filter(Boolean);
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO video_review (asset_id, owner_id, project_id, caption, hashtags)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (asset_id) DO UPDATE SET caption = EXCLUDED.caption, hashtags = EXCLUDED.hashtags, updated_at = now()`,
      [video.rows[0].id, request.user!.id, video.rows[0].project_id, caption.trim(), normalizedHashtags],
    );
    if (versionId) {
      await client.query(
        `DELETE FROM approval WHERE project_version_id = $1 AND asset_id = $2 AND stage = 'FINAL_RENDER'`,
        [versionId, video.rows[0].id],
      );
      if (approve) {
        await client.query(
          `INSERT INTO approval (project_id, project_version_id, asset_id, stage, approved_by)
           VALUES ($1, $2, $3, 'FINAL_RENDER', $4)`,
          [video.rows[0].project_id, versionId, video.rows[0].id, request.user!.id],
        );
      }
    }
    await client.query('COMMIT');
    return response.json({ saved: true, approved: approve, updatedAt: new Date().toISOString() });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Video review save failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not save this review. Try again.' });
  } finally { client.release(); }
});

app.post('/api/v1/videos/:assetId/caption-suggestions', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return response.status(503).json({ error: 'Add GEMINI_API_KEY or OPENAI_API_KEY to .env to generate caption ideas.' });
  try {
    const result = await requireDatabase().query(
      `SELECT COALESCE(av.storyboard_metadata->>'topic', p.topic) AS topic,
              COALESCE(av.storyboard_metadata->>'audience', p.audience) AS audience,
              av.storyboard_metadata->'scenes' AS scenes
       FROM asset a JOIN project p ON p.id = a.project_id
       LEFT JOIN project_version av ON av.id = a.project_version_id
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Video not found.' });
    const { topic, audience, scenes } = result.rows[0] as { topic: string; audience: string; scenes: Array<{ label?: string; narration?: string; caption?: string }> | null };
    const lessonSummary = (scenes ?? []).map(scene => `${scene.label ?? ''}: ${scene.narration ?? scene.caption ?? ''}`).join('\n').slice(0, 7000);
    const prompt = `Write an Instagram Reel caption and 5 to 8 relevant hashtags for this educational video. Audience: ${audience}. Topic: ${topic}. Lesson content:\n${lessonSummary}\nKeep the caption friendly, clear, useful, and accurate. Do not invent lesson facts or claim the video covers anything absent from the lesson. Return JSON only as {"caption":"...","hashtags":["...", ...]}. Hashtags should be plain words without #, short, relevant, and include a mix of broad and specific educational terms.`;
    let generated = '';
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await ai.models.generateContent({
          model: process.env.GEMINI_TEXT_MODEL || 'gemini-3.8-flash', contents: prompt,
          config: { responseMimeType: 'application/json', responseJsonSchema: { type: 'object', properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } }, required: ['caption', 'hashtags'], additionalProperties: false } },
        });
        generated = result.text ?? '';
      } catch (error) {
        if (!process.env.OPENAI_API_KEY) throw error;
      }
    }
    if (!generated && process.env.OPENAI_API_KEY) {
      const openAiResponse = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.OPENAI_TEXT_MODEL || 'gpt-6-astra', input: prompt, text: { format: { type: 'json_schema', name: 'instagram_post_copy', strict: true, schema: { type: 'object', properties: { caption: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } }, required: ['caption', 'hashtags'], additionalProperties: false } } } }),
      });
      const payload = await openAiResponse.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
      if (!openAiResponse.ok) throw new Error('OpenAI caption generation failed.');
      generated = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === 'output_text')?.text ?? '';
    }
    const parsed = JSON.parse(generated) as { caption?: unknown; hashtags?: unknown };
    if (typeof parsed.caption !== 'string' || !Array.isArray(parsed.hashtags)) throw new Error('Caption model returned an invalid result.');
    const normalized = parsed.hashtags.map(tag => typeof tag === 'string' ? tag.trim().replace(/^#+/, '') : '').filter(tag => /^[\p{L}\p{N}_]+$/u.test(tag)).slice(0, 15);
    return response.json({ caption: parsed.caption.slice(0, 5000), hashtags: [...new Set(normalized)] });
  } catch (error) {
    console.error('Instagram caption generation failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(502).json({ error: 'Could not create caption ideas. Try again or edit the post text yourself.' });
  }
});

app.post('/api/v1/social/instagram/connect', async (request, response) => {
  if (!instagramConfigReady()) return response.status(503).json({ error: 'Instagram setup is incomplete. Add the Meta app id, app secret, redirect URI, and token encryption key to .env, then restart the app.' });
  try {
    const state = randomBytes(32).toString('hex');
    const redirectUri = instagramCallbackUrl();
    const returnAssetId = typeof request.body?.assetId === 'string' && /^[0-9a-f-]{36}$/i.test(request.body.assetId) ? request.body.assetId : null;
    if (returnAssetId) {
      const ownsVideo = await requireDatabase().query(
        `SELECT 1 FROM asset a JOIN project p ON p.id = a.project_id WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
        [returnAssetId, request.user!.id],
      );
      if (!ownsVideo.rowCount) return response.status(404).json({ error: 'Video not found.' });
    }
    await requireDatabase().query(
      `INSERT INTO oauth_state (owner_id, state_hash, redirect_uri, return_asset_id, expires_at) VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`,
      [request.user!.id, createHash('sha256').update(state).digest('hex'), redirectUri, returnAssetId],
    );
    return response.json({ authorizationUrl: instagramAuthorizationUrl(state) });
  } catch (error) {
    console.error('Instagram connect setup failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not start Instagram connection. Check the Instagram settings in .env.' });
  }
});

function redirectToApp(query: Record<string, string>): string {
  const base = new URL(process.env.APP_BASE_URL?.trim() || 'http://localhost:5173');
  if (base.protocol !== 'https:' && base.hostname !== 'localhost' && base.hostname !== '127.0.0.1') throw new Error('APP_BASE_URL must use HTTPS outside local development.');
  base.pathname = '/'; base.search = ''; base.hash = '';
  for (const [key, value] of Object.entries(query)) base.searchParams.set(key, value);
  return base.toString();
}

app.get('/api/v1/social/instagram/callback', async (request, response) => {
  const fail = (message: string) => response.redirect(redirectToApp({ instagram: 'error', message }));
  if (typeof request.query.error === 'string') return fail('Instagram did not authorize the connection. You can try again.');
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const state = typeof request.query.state === 'string' ? request.query.state : '';
  if (!code || !/^[a-f0-9]{64}$/i.test(state)) return fail('Instagram returned an incomplete authorization response.');
  const db = requireDatabase();
  const client = await db.connect();
  try {
    const stateHash = createHash('sha256').update(state).digest('hex');
    await client.query('BEGIN');
    const storedState = await client.query(
      `SELECT id, owner_id AS "ownerId", return_asset_id AS "returnAssetId" FROM oauth_state WHERE state_hash = $1 AND redirect_uri = $2 AND expires_at > now() AND consumed_at IS NULL FOR UPDATE`,
      [stateHash, instagramCallbackUrl()],
    );
    if (!storedState.rowCount) { await client.query('ROLLBACK'); return fail('Instagram connection expired. Start Connect Instagram again.'); }
    const ownerId = storedState.rows[0].ownerId as string;
    const returnAssetId = storedState.rows[0].returnAssetId as string | null;
    await client.query('UPDATE oauth_state SET consumed_at = now() WHERE id = $1', [storedState.rows[0].id]);
    await client.query('COMMIT');
    const account = await exchangeInstagramCode(code);
    const existing = await db.query('SELECT id, owner_id FROM social_account WHERE provider = \'INSTAGRAM\' AND platform_account_id = $1', [account.platformAccountId]);
    if (existing.rowCount && existing.rows[0].owner_id !== ownerId) return fail('That Instagram account is already connected to a different app user.');
    if (existing.rowCount) {
      await db.query(
        `UPDATE social_account SET username = $2, account_type = $3, encrypted_access_token = $4, encryption_key_version = 'v1', token_expires_at = $5, status = 'CONNECTED', updated_at = now() WHERE id = $1`,
        [existing.rows[0].id, account.username, account.accountType, account.encryptedAccessToken, account.tokenExpiresAt],
      );
    } else {
      await db.query(
        `INSERT INTO social_account (owner_id, provider, platform_account_id, username, account_type, encrypted_access_token, encryption_key_version, token_expires_at, granted_scopes)
         VALUES ($1, 'INSTAGRAM', $2, $3, $4, $5, 'v1', $6, ARRAY['instagram_business_basic','instagram_business_content_publish'])`,
        [ownerId, account.platformAccountId, account.username, account.accountType, account.encryptedAccessToken, account.tokenExpiresAt],
      );
    }
    return response.redirect(redirectToApp({ instagram: 'connected', ...(returnAssetId ? { asset: returnAssetId } : {}) }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const rawMessage = error instanceof Error ? error.message : 'Unknown error';
    const safeMessage = rawMessage
      .replace(/\b(client_secret|access_token|authorization_code|code|state)\s*[:=]\s*[^\s,&]+/gi, '$1=[redacted]')
      .slice(0, 240);
    console.error('Instagram OAuth callback failed:', safeMessage);
    return fail(`Instagram connection failed: ${safeMessage}`);
  } finally { client.release(); }
});

app.get('/api/v1/social/accounts', async (request, response) => {
  try {
    const accounts = await requireDatabase().query(
      `SELECT id, username, account_type AS "accountType", status, token_expires_at AS "tokenExpiresAt"
       FROM social_account WHERE owner_id = $1 AND provider = 'INSTAGRAM' AND status <> 'DISCONNECTED' ORDER BY created_at DESC`,
      [request.user!.id],
    );
    return response.json({ accounts: accounts.rows });
  } catch (error) {
    console.error('Instagram account list failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not load connected Instagram accounts.' });
  }
});

app.delete('/api/v1/social/accounts/:accountId', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.accountId)) return response.status(404).end();
  try {
    const removed = await requireDatabase().query('DELETE FROM social_account WHERE id = $1 AND owner_id = $2 RETURNING id', [request.params.accountId, request.user!.id]);
    if (!removed.rowCount) return response.status(404).json({ error: 'Instagram account not found.' });
    return response.json({ disconnected: true });
  } catch (error) {
    console.error('Instagram disconnect failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not disconnect Instagram.' });
  }
});

async function processInstagramPublish(postId: string) {
  const db = requireDatabase();
  let accountId = '';
  try {
    const result = await db.query(
      `SELECT sp.owner_id AS "ownerId", sp.video_asset_id AS "assetId", sp.caption, sp.hashtags,
              sa.id AS "accountId", sa.platform_account_id AS "platformAccountId", sa.encrypted_access_token AS "encryptedToken", sa.token_expires_at AS "tokenExpiresAt", a.storage_key AS "storageKey"
       FROM scheduled_post sp JOIN social_account sa ON sa.id = sp.social_account_id
       JOIN asset a ON a.id = sp.video_asset_id
       WHERE sp.id = $1 AND sp.status = 'PUBLISHING' AND sa.status = 'CONNECTED'`, [postId],
    );
    if (!result.rowCount) throw new Error('The connected Instagram account is no longer available.');
    const post = result.rows[0] as { accountId: string; platformAccountId: string; encryptedToken: string; tokenExpiresAt: Date | null; storageKey: string; caption: string; hashtags: string[] };
    accountId = post.accountId;
    const videoUrl = await getInstagramMediaUrl(post.storageKey);
    const caption = [post.caption.trim(), post.hashtags.map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');
    const published = await publishInstagramReel({ accountId: post.platformAccountId, encryptedToken: post.encryptedToken, tokenExpiresAt: post.tokenExpiresAt, videoUrl, caption });
    await db.query(
      `UPDATE social_account SET encrypted_access_token = $2, token_expires_at = $3, updated_at = now() WHERE id = $1`,
      [post.accountId, published.encryptedToken, published.tokenExpiresAt],
    );
    await db.query(
      `UPDATE scheduled_post SET status = 'PUBLISHED', platform_post_id = $2, updated_at = now() WHERE id = $1`, [postId, published.platformPostId],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Instagram publishing failed.';
    const authorizationFailed = /token|secret|access.?key|authorization|oauth/i.test(message);
    const safeMessage = authorizationFailed ? 'Instagram authorization failed. Reconnect your account and try again.' : message.slice(0, 500);
    if (authorizationFailed && accountId) await db.query(`UPDATE social_account SET status = 'REAUTH_REQUIRED', updated_at = now() WHERE id = $1`, [accountId]);
    await db.query(
      `UPDATE scheduled_post SET status = 'FAILED', last_error_code = 'INSTAGRAM_PUBLISH_FAILED', last_error_message_safe = $2, updated_at = now() WHERE id = $1 AND status = 'PUBLISHING'`,
      [postId, safeMessage],
    );
  }
}

app.post('/api/v1/videos/:assetId/publish', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.assetId)) return response.status(404).end();
  const socialAccountId = typeof request.body?.socialAccountId === 'string' ? request.body.socialAccountId : '';
  if (!/^[0-9a-f-]{36}$/i.test(socialAccountId)) return response.status(400).json({ error: 'Connect an Instagram account before publishing.' });
  const db = requireDatabase();
  try {
    const video = await db.query(
      `SELECT a.id, a.project_id AS "projectId", a.project_version_id AS "versionId", a.storage_key AS "storageKey",
              r.caption, r.hashtags,
              EXISTS (SELECT 1 FROM approval ap WHERE ap.asset_id = a.id AND ap.project_version_id = a.project_version_id AND ap.stage = 'FINAL_RENDER') AS approved
       FROM asset a JOIN project p ON p.id = a.project_id
       LEFT JOIN video_review r ON r.asset_id = a.id AND r.owner_id = p.owner_id
       WHERE a.id = $1 AND a.asset_type = 'FINAL_VIDEO' AND p.owner_id = $2 AND p.deleted_at IS NULL`,
      [request.params.assetId, request.user!.id],
    );
    if (!video.rowCount) return response.status(404).json({ error: 'Video not found.' });
    const asset = video.rows[0] as { projectId: string; versionId: string | null; storageKey: string; caption: string; hashtags: string[]; approved: boolean };
    if (!asset.versionId || !asset.approved) return response.status(409).json({ error: 'Save and approve this exact video and caption before publishing.' });
    const finalCaption = [asset.caption?.trim() ?? '', (asset.hashtags ?? []).map(tag => `#${tag}`).join(' ')].filter(Boolean).join('\n\n');
    if (finalCaption.length > 2200 || (asset.hashtags ?? []).length > 30) return response.status(400).json({ error: 'Instagram allows up to 2,200 post-text characters and 30 hashtags. Shorten the saved caption before publishing.' });
    const account = await db.query(
      `SELECT id FROM social_account WHERE id = $1 AND owner_id = $2 AND provider = 'INSTAGRAM' AND status = 'CONNECTED'`, [socialAccountId, request.user!.id],
    );
    if (!account.rowCount) return response.status(404).json({ error: 'Connect an Instagram account before publishing.' });
    await getInstagramMediaUrl(asset.storageKey);
    const active = await db.query(
      `SELECT id FROM scheduled_post WHERE video_asset_id = $1 AND social_account_id = $2 AND status = 'PUBLISHING'`, [request.params.assetId, socialAccountId],
    );
    if (active.rowCount) return response.status(409).json({ error: 'This video is already being sent to Instagram.' });
    const insert = await db.query(
      `INSERT INTO scheduled_post (owner_id, project_id, project_version_id, social_account_id, video_asset_id, caption, hashtags, scheduled_at, timezone, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 'UTC', 'PUBLISHING') RETURNING id`,
      [request.user!.id, asset.projectId, asset.versionId, socialAccountId, request.params.assetId, asset.caption ?? '', asset.hashtags ?? []],
    );
    const postId = insert.rows[0].id as string;
    response.status(202).json({ postId, status: 'PUBLISHING' });
    void processInstagramPublish(postId).catch(error => console.error('Instagram publishing status could not be saved:', error instanceof Error ? error.message : 'Unknown error'));
    return;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'This video is already being sent to Instagram.' });
    console.error('Instagram publish request failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: error instanceof Error && /R2|video is not available/.test(error.message) ? error.message : 'Could not start Instagram publishing. Try again.' });
  }
});

app.get('/api/v1/posts/:postId', async (request, response) => {
  if (!/^[0-9a-f-]{36}$/i.test(request.params.postId)) return response.status(404).end();
  try {
    const result = await requireDatabase().query(
      `SELECT id, status, platform_post_id AS "platformPostId", last_error_message_safe AS error, updated_at AS "updatedAt"
       FROM scheduled_post WHERE id = $1 AND owner_id = $2`, [request.params.postId, request.user!.id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Publish job not found.' });
    return response.json({ post: result.rows[0] });
  } catch (error) {
    console.error('Instagram publish status failed:', error instanceof Error ? error.message : 'Unknown error');
    return response.status(503).json({ error: 'Could not load publishing status.' });
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
    if (!await hasStoredObject(`renders/${id}.mp4`)) return response.status(404).json({ error: 'Rendered video is no longer available.' });
    return response.json({ status: 'complete', progress: 1, downloadUrl: `/api/render-video/${id}/download` });
  }
  if (job.status === 'complete') {
    try {
      if (await hasStoredObject(`renders/${id}.mp4`)) return response.json({ ...job, downloadUrl: `/api/render-video/${id}/download` });
    } catch { /* Report the in-memory job state if its file was removed. */ }
  }
  return response.json(job);
});

app.get('/api/render-video/:renderId/download', async (request, response) => {
  const id = request.params.renderId;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return response.status(404).end();
  try {
    const ownedAsset = await requireDatabase().query(
      `SELECT a.storage_key FROM asset a JOIN project p ON p.id = a.project_id
       WHERE a.storage_key = $1 AND p.owner_id = $2`, [`renders/${id}.mp4`, request.user!.id],
    );
    if (!ownedAsset.rowCount) return response.status(404).end();
    const delivery = await getPrivateDownload(ownedAsset.rows[0].storage_key, 'little-lessons.mp4');
    if (!delivery) return response.status(404).end();
    if (delivery.kind === 'r2') return response.redirect(delivery.url);
    response.download(delivery.filepath, 'little-lessons.mp4');
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
        audioSrc: audioId ? `data:audio/mpeg;base64,${(await readStoredObject(`audio/${audioId}.mp3`)).toString('base64')}` : undefined,
        audioDurationSeconds: duration,
        sceneTimings: timings,
      };
      const composition = await selectComposition({ serveUrl, id: 'LessonVideo', inputProps, ...remotionBrowserOptions });
      const videoKey = `renders/${renderId}.mp4`;
      const videoPath = resolve('.data', videoKey);
      await renderMedia({
        composition, serveUrl, codec: 'h264', outputLocation: videoPath, ...remotionBrowserOptions,
        inputProps, onProgress: ({ progress }) => { renderJobs.set(renderId, { status: 'rendering', progress, userId: request.user!.id, projectId }); },
      });
      await storeFile(videoKey, videoPath, 'video/mp4');
      const currentVersion = await requireDatabase().query(
        'SELECT id FROM project_version WHERE project_id = $1 AND is_current = TRUE', [projectId],
      );
      const videoInfo = await stat(videoPath);
      await requireDatabase().query(
        `INSERT INTO asset (project_id, project_version_id, asset_type, storage_key, media_type, byte_size, provider)
         VALUES ($1, $2, 'FINAL_VIDEO', $3, 'video/mp4', $4, 'REMOTION')`,
        [projectId, currentVersion.rows[0]?.id ?? null, videoKey, videoInfo.size],
      );
      await removeLocalObject(videoKey);
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
    const delivery = await getPrivateDownload(`audio/${request.params.assetId}.mp3`);
    if (!delivery) return response.status(404).end();
    if (delivery.kind === 'r2') return response.redirect(delivery.url);
    const audio = await readFile(delivery.filepath);
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
    await storeBuffer(`audio/${audioId}.mp3`, Buffer.from(generated.audio_base64, 'base64'), 'audio/mpeg');
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
