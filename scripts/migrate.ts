import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before running database migrations.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined });

try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  const hasUsers = await pool.query("SELECT to_regclass('public.app_user') IS NOT NULL AS present");
  if (!hasUsers.rows[0].present) {
    await pool.query(await readFile(resolve('docs', 'schema.sql'), 'utf8'));
    console.log('Applied docs/schema.sql');
  }
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const migrations = (await readdir(resolve('db', 'migrations'))).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const seen = await pool.query('SELECT 1 FROM schema_migration WHERE name = $1', [name]);
    if (seen.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(await readFile(resolve('db', 'migrations', name), 'utf8'));
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [name]);
      await client.query('COMMIT');
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
} finally { await pool.end(); }
