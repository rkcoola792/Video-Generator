import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not configured. Account and project endpoints will be unavailable until a PostgreSQL database is configured.');
}

export const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined })
  : null;

export function requireDatabase() {
  if (!pool) throw new Error('Database is not configured. Set DATABASE_URL and run npm run db:migrate.');
  return pool;
}
