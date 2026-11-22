import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://frontdesk:frontdesk_secret@localhost:5432/frontdesk_dev',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function checkDbHealth(): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await pool.query('SELECT 1 as healthy');
    if (res.rows[0]?.healthy === 1) {
      return { ok: true };
    }
    return { ok: false, message: 'Unexpected query result' };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, message: errorMessage };
  }
}

