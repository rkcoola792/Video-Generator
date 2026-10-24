import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { requireDatabase } from './database';

const SESSION_COOKIE = 'little_lessons_session';
const SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type AuthUser = { id: string; email: string; displayName: string };
declare global { namespace Express { interface Request { user?: AuthUser } } }

export function hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }

export function requireAuth(request: Request, response: Response, next: NextFunction) {
  void (async () => {
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return response.status(401).json({ error: 'Please sign in to continue.' });
    const db = requireDatabase();
    const result = await db.query(
      `SELECT u.id, u.email, u.display_name AS "displayName"
       FROM app_session s JOIN app_user u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [hashToken(token)],
    );
    if (!result.rowCount) return response.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    request.user = result.rows[0] as AuthUser;
    next();
  })().catch(error => {
    console.error('Authentication lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    response.status(503).json({ error: error instanceof Error && error.message.includes('not configured') ? error.message : 'Authentication is temporarily unavailable.' });
  });
}

function readCookie(header: string | undefined, name: string) {
  const pair = header?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : '';
}

export function setSessionCookie(response: Response, token: string) {
  response.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_AGE_MS });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

async function issueSession(userId: string, response: Response) {
  const db = requireDatabase();
  const token = randomBytes(32).toString('hex');
  await db.query('INSERT INTO app_session (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval \'30 days\')', [hashToken(token), userId]);
  setSessionCookie(response, token);
}

async function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await derivePasswordKey(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

async function passwordMatches(password: string, stored: string) {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !/^[a-f0-9]{128}$/i.test(keyHex ?? '')) return false;
  const derived = await derivePasswordKey(password, salt);
  return timingSafeEqual(derived, Buffer.from(keyHex, 'hex'));
}

function derivePasswordKey(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

type RateLimitEntry = { count: number; resetAt: number };
const authAttempts = new Map<string, RateLimitEntry>();
export function limitAuthAttempts(request: Request, response: Response, next: NextFunction) {
  const key = `${request.ip}:${request.path}`;
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt <= now) authAttempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
  else if (entry.count >= 10) return response.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
  else entry.count += 1;
  if (authAttempts.size > 5000) for (const [entryKey, value] of authAttempts) if (value.resetAt <= now) authAttempts.delete(entryKey);
  next();
}

export async function registerUser(input: { email: unknown; password: unknown; displayName: unknown }, response: Response) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { status: 400, body: { error: 'Enter a valid email address.' } };
  if (password.length < 10 || password.length > 200) return { status: 400, body: { error: 'Use a password between 10 and 200 characters.' } };
  if (displayName.length > 80) return { status: 400, body: { error: 'Name must be 80 characters or fewer.' } };
  const db = requireDatabase();
  try {
    const inserted = await db.query(
      'INSERT INTO app_user (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, display_name AS "displayName"',
      [email, displayName || email.split('@')[0], await passwordHash(password)],
    );
    const user = inserted.rows[0] as AuthUser;
    await issueSession(user.id, response);
    return { status: 201, body: { user } };
  } catch (error) {
    if ((error as { code?: string }).code === '23505') return { status: 409, body: { error: 'An account with that email already exists.' } };
    throw error;
  }
}

export async function loginUser(input: { email: unknown; password: unknown }, response: Response) {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (email.length > 254 || !email || password.length > 200) return { status: 401, body: { error: 'Email or password is incorrect.' } };
  const db = requireDatabase();
  const result = await db.query('SELECT id, email, display_name AS "displayName", password_hash FROM app_user WHERE lower(email) = $1', [email]);
  const row = result.rows[0] as (AuthUser & { password_hash: string | null }) | undefined;
  if (!row?.password_hash || !(await passwordMatches(password, row.password_hash))) return { status: 401, body: { error: 'Email or password is incorrect.' } };
  await issueSession(row.id, response);
  return { status: 200, body: { user: { id: row.id, email: row.email, displayName: row.displayName } } };
}

export function sessionUser(request: Request) { return request.user ?? null; }
