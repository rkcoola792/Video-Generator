import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const config = {
  endpoint: process.env.R2_ENDPOINT?.trim(),
  bucket: process.env.R2_BUCKET_NAME?.trim(),
  accessKeyId: process.env.R2_ACCESS_KEY_ID?.trim(),
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim(),
};
const configEntries = Object.values(config);
const anyR2Setting = configEntries.some(Boolean);
const completeR2Config = configEntries.every(Boolean);

if (anyR2Setting && !completeR2Config) {
  throw new Error('R2 configuration is incomplete. Set R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
}
if (config.endpoint && !config.endpoint.startsWith('https://')) {
  throw new Error('R2_ENDPOINT must use HTTPS.');
}

const r2 = completeR2Config
  ? new S3Client({
      region: 'auto',
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId!, secretAccessKey: config.secretAccessKey! },
    })
  : null;

export const mediaStorageMode = r2 ? 'r2' : 'local';

if (!r2) console.warn('R2 is not configured; video and audio assets will remain in local .data storage.');

export function localMediaPath(key: string): string {
  const normalized = key.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || segments.some(part => !part || part === '.' || part === '..')) {
    throw new Error('Invalid media storage key.');
  }
  const root = resolve('.data');
  const filepath = resolve(root, ...segments);
  if (!filepath.startsWith(`${root}${sep}`)) throw new Error('Invalid media storage key.');
  return filepath;
}

function isMissingObject(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = error as Error & { $metadata?: { httpStatusCode?: number }; Code?: string };
  return error.name === 'NotFound' || details.Code === 'NoSuchKey' || details.$metadata?.httpStatusCode === 404;
}

async function localObjectExists(key: string): Promise<boolean> {
  try {
    await stat(localMediaPath(key));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function hasStoredObject(key: string): Promise<boolean> {
  if (!r2) return localObjectExists(key);
  try {
    await r2.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (!isMissingObject(error)) throw error;
    return localObjectExists(key);
  }
}

export async function readStoredObject(key: string): Promise<Buffer> {
  if (r2) {
    try {
      const object = await r2.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      if (!object.Body) throw new Error('R2 returned an empty media object.');
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }
  return readFile(localMediaPath(key));
}

export async function storeBuffer(key: string, body: Buffer, contentType: string): Promise<void> {
  if (r2) {
    await r2.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: contentType }));
    return;
  }
  const filepath = localMediaPath(key);
  await mkdir(resolve(filepath, '..'), { recursive: true });
  await writeFile(filepath, body);
}

export async function storeFile(key: string, filepath: string, contentType: string): Promise<void> {
  if (r2) {
    const fileInfo = await stat(filepath);
    await r2.send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: createReadStream(filepath),
      ContentLength: fileInfo.size,
      ContentType: contentType,
    }));
    return;
  }
  const destination = localMediaPath(key);
  if (resolve(filepath) === destination) return;
  await mkdir(resolve(destination, '..'), { recursive: true });
  await copyFile(filepath, destination);
}

export async function removeLocalObject(key: string): Promise<void> {
  if (!r2) return;
  try { await unlink(localMediaPath(key)); } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }
}

export async function getPrivateDownload(key: string, downloadFilename?: string, expiresInSeconds = 600): Promise<{ kind: 'r2'; url: string } | { kind: 'local'; filepath: string } | null> {
  if (r2) {
    try {
      await r2.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      const safeFilename = downloadFilename && /^[a-zA-Z0-9._-]+$/.test(downloadFilename) ? downloadFilename : undefined;
      const url = await getSignedUrl(r2, new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ...(safeFilename ? { ResponseContentDisposition: `attachment; filename="${safeFilename}"` } : {}),
      }), { expiresIn: expiresInSeconds });
      return { kind: 'r2', url };
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  }
  const filepath = localMediaPath(key);
  return await localObjectExists(key) ? { kind: 'local', filepath } : null;
}

export async function getInstagramMediaUrl(key: string): Promise<string> {
  if (!r2) throw new Error('Instagram can only fetch a finished video from R2. Configure the R2 settings, then export the video again.');
  const delivery = await getPrivateDownload(key, undefined, 60 * 60 * 2);
  if (!delivery || delivery.kind !== 'r2') throw new Error('The video is not available in R2 yet. Export it again before publishing.');
  return delivery.url;
}

export function requireR2Storage(): void {
  if (!r2) throw new Error('R2 is not configured. Set R2_ENDPOINT, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
}

export async function r2ObjectExists(key: string): Promise<boolean> {
  requireR2Storage();
  try {
    await r2!.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return true;
  } catch (error) {
    if (isMissingObject(error)) return false;
    throw error;
  }
}
