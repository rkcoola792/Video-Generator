import 'dotenv/config';
import { stat } from 'node:fs/promises';
import { localMediaPath, requireR2Storage, r2ObjectExists, storeFile } from '../server/media-storage';
import { requireDatabase } from '../server/database';

const pool = requireDatabase();
requireR2Storage();

try {
  const assets = await pool.query<{ storage_key: string; media_type: string }>(
    `SELECT storage_key, media_type FROM asset
     WHERE asset_type IN ('FINAL_VIDEO', 'NARRATION_AUDIO')
     ORDER BY created_at`,
  );
  let uploaded = 0;
  let alreadyInR2 = 0;
  let localFileMissing = 0;

  for (const asset of assets.rows) {
    if (await r2ObjectExists(asset.storage_key)) {
      alreadyInR2 += 1;
      continue;
    }
    const filepath = localMediaPath(asset.storage_key);
    try { await stat(filepath); } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        localFileMissing += 1;
        console.warn(`Local file is missing for asset ${asset.storage_key}; skipped.`);
        continue;
      }
      throw error;
    }
    await storeFile(asset.storage_key, filepath, asset.media_type);
    uploaded += 1;
    console.log(`Uploaded ${asset.storage_key}`);
  }

  console.log(`R2 migration finished: ${uploaded} uploaded, ${alreadyInR2} already present, ${localFileMissing} missing locally.`);
} finally {
  await pool.end();
}
