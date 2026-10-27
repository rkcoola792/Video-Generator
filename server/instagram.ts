import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const API_VERSION = process.env.INSTAGRAM_GRAPH_API_VERSION?.trim() || 'v26.0';
const GRAPH_ROOT = `https://graph.instagram.com/${API_VERSION}`;

function tokenKey(): Buffer {
  const configured = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) throw new Error('Set TOKEN_ENCRYPTION_KEY in .env before connecting Instagram.');
  const key = /^[a-f0-9]{64}$/i.test(configured) ? Buffer.from(configured, 'hex') : Buffer.from(configured, 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be a 32-byte hex or base64 value.');
  return key;
}

export function encryptInstagramToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptInstagramToken(value: string): string {
  const [ivPart, tagPart, encryptedPart] = value.split('.');
  if (!ivPart || !tagPart || !encryptedPart) throw new Error('Stored Instagram token is invalid.');
  const decipher = createDecipheriv('aes-256-gcm', tokenKey(), Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8');
}

export function instagramConfigReady(): boolean {
  return Boolean(process.env.INSTAGRAM_APP_ID?.trim() && process.env.INSTAGRAM_APP_SECRET?.trim() && process.env.INSTAGRAM_REDIRECT_URI?.trim() && process.env.TOKEN_ENCRYPTION_KEY?.trim());
}

export function instagramCallbackUrl(): string {
  const value = process.env.INSTAGRAM_REDIRECT_URI?.trim();
  if (!value) throw new Error('Set INSTAGRAM_REDIRECT_URI in .env.');
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Instagram redirect URL must use HTTPS outside local development.');
  return url.toString();
}

export function instagramAuthorizationUrl(state: string): string {
  const url = new URL('https://www.instagram.com/oauth/authorize');
  url.searchParams.set('client_id', process.env.INSTAGRAM_APP_ID!.trim());
  url.searchParams.set('redirect_uri', instagramCallbackUrl());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'instagram_business_basic,instagram_business_content_publish');
  url.searchParams.set('state', state);
  return url.toString();
}

async function readMetaJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    const error = payload.error as { message?: string } | undefined;
    throw new Error(error?.message || `Instagram API request failed (${response.status}).`);
  }
  return payload;
}

export async function exchangeInstagramCode(code: string) {
  const body = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!.trim(),
    client_secret: process.env.INSTAGRAM_APP_SECRET!.trim(),
    grant_type: 'authorization_code',
    redirect_uri: instagramCallbackUrl(),
    code,
  });
  const shortTokenResponse = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body });
  const shortToken = await readMetaJson(shortTokenResponse) as { access_token: string; user_id: string | number };
  const longUrl = new URL(`${GRAPH_ROOT}/access_token`);
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', process.env.INSTAGRAM_APP_SECRET!.trim());
  longUrl.searchParams.set('access_token', shortToken.access_token);
  const longToken = await readMetaJson(await fetch(longUrl)) as { access_token: string; token_type?: string; expires_in?: number };
  const profileUrl = new URL(`${GRAPH_ROOT}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username,account_type');
  profileUrl.searchParams.set('access_token', longToken.access_token);
  const profile = await readMetaJson(await fetch(profileUrl)) as { user_id?: string | number; id?: string | number; username?: string; account_type?: string };
  const accountId = String(profile.user_id ?? profile.id ?? shortToken.user_id ?? '');
  if (!accountId || !profile.username) throw new Error('Instagram did not return a usable professional account profile.');
  return {
    platformAccountId: accountId,
    username: profile.username,
    accountType: profile.account_type ?? 'PROFESSIONAL',
    encryptedAccessToken: encryptInstagramToken(longToken.access_token),
    tokenExpiresAt: longToken.expires_in ? new Date(Date.now() + Number(longToken.expires_in) * 1000) : null,
  };
}

async function refreshToken(encryptedToken: string): Promise<{ token: string; expiresAt: Date | null }> {
  let token = decryptInstagramToken(encryptedToken);
  const refreshUrl = new URL(`${GRAPH_ROOT}/refresh_access_token`);
  refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
  refreshUrl.searchParams.set('access_token', token);
  const result = await readMetaJson(await fetch(refreshUrl)) as { access_token?: string; expires_in?: number };
  if (result.access_token) token = result.access_token;
  return { token, expiresAt: result.expires_in ? new Date(Date.now() + Number(result.expires_in) * 1000) : null };
}

export async function publishInstagramReel(input: { accountId: string; encryptedToken: string; tokenExpiresAt: Date | null; videoUrl: string; caption: string }) {
  let { token, expiresAt } = { token: decryptInstagramToken(input.encryptedToken), expiresAt: input.tokenExpiresAt };
  let refreshed = false;
  if (expiresAt && expiresAt.getTime() < Date.now() + 7 * 24 * 60 * 60 * 1000) {
    ({ token, expiresAt } = await refreshToken(input.encryptedToken));
    refreshed = true;
  }
  const createUrl = new URL(`${GRAPH_ROOT}/${encodeURIComponent(input.accountId)}/media`);
  const createBody = new URLSearchParams({ media_type: 'REELS', video_url: input.videoUrl, caption: input.caption, share_to_feed: 'true', access_token: token });
  const container = await readMetaJson(await fetch(createUrl, { method: 'POST', body: createBody })) as { id?: string };
  if (!container.id) throw new Error('Instagram did not return a Reel upload container.');

  for (let attempt = 0; attempt < 36; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const statusUrl = new URL(`${GRAPH_ROOT}/${encodeURIComponent(container.id)}`);
    statusUrl.searchParams.set('fields', 'status_code,status');
    statusUrl.searchParams.set('access_token', token);
    const result = await readMetaJson(await fetch(statusUrl)) as { status_code?: string; status?: string };
    if (result.status_code === 'FINISHED') break;
    if (result.status_code === 'ERROR' || result.status_code === 'EXPIRED') throw new Error(result.status || `Instagram video processing ${result.status_code.toLowerCase()}.`);
    if (attempt === 35) throw new Error('Instagram is still processing the video. Please retry in a few minutes.');
  }

  const publishUrl = new URL(`${GRAPH_ROOT}/${encodeURIComponent(input.accountId)}/media_publish`);
  const published = await readMetaJson(await fetch(publishUrl, { method: 'POST', body: new URLSearchParams({ creation_id: container.id, access_token: token }) })) as { id?: string };
  if (!published.id) throw new Error('Instagram did not return the published Reel id.');
  return { platformPostId: published.id, tokenExpiresAt: expiresAt, encryptedToken: refreshed ? encryptInstagramToken(token) : input.encryptedToken };
}
