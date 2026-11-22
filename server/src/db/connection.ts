import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { DbClient } from './transaction.js';

dotenv.config();

const { Pool } = pg;

export interface FrontdeskDbClient {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
  release: () => void;
}

export interface FrontdeskDb extends DbClient {
  query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }>;
  connect?: () => Promise<FrontdeskDbClient>;
  end?: () => Promise<void>;
  isEmbedded?: boolean;
}

let activeDb: FrontdeskDb | null = null;
let initPromise: Promise<FrontdeskDb> | null = null;

const rawPool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://frontdesk:frontdesk_secret@localhost:5432/frontdesk_dev',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 1500,
});

export async function getOrInitDb(): Promise<FrontdeskDb> {
  if (activeDb) return activeDb;
  if (initPromise) return initPromise;

  initPromise = (async (): Promise<FrontdeskDb> => {
    // 1. If explicit DATABASE_URL is provided, use standard pg.Pool
    if (process.env.DATABASE_URL) {
      activeDb = {
        isEmbedded: false,
        query: async <R = any>(text: string, params?: unknown[]) => {
          const res = await rawPool.query(text, params);
          return { rows: res.rows as R[], rowCount: res.rowCount };
        },
        connect: async (): Promise<FrontdeskDbClient> => {
          const c = await rawPool.connect();
          return {
            query: async <R = any>(text: string, params?: unknown[]) => {
              const res = await c.query(text, params);
              return { rows: res.rows as R[], rowCount: res.rowCount };
            },
            release: () => c.release(),
          };
        },
        end: () => rawPool.end(),
      };
      return activeDb;
    }

    // 2. Otherwise probe if local PostgreSQL on 5432 is running
    try {
      const probeRes = await rawPool.query('SELECT 1 as healthy');
      if (probeRes.rows[0]?.healthy === 1) {
        console.log('Connected to local PostgreSQL service on localhost:5432.');
        activeDb = {
          isEmbedded: false,
          query: async <R = any>(text: string, params?: unknown[]) => {
            const res = await rawPool.query(text, params);
            return { rows: res.rows as R[], rowCount: res.rowCount };
          },
          connect: async (): Promise<FrontdeskDbClient> => {
            const c = await rawPool.connect();
            return {
              query: async <R = any>(text: string, params?: unknown[]) => {
                const res = await c.query(text, params);
                return { rows: res.rows as R[], rowCount: res.rowCount };
              },
              release: () => c.release(),
            };
          },
          end: () => rawPool.end(),
        };
        return activeDb;
      }
    } catch {
      // Local PostgreSQL is not reachable, fall through to embedded PGlite
    }

    // 3. Fallback: Initialize persistent embedded PostgreSQL (PGlite)
    console.log('ℹ️  No local PostgreSQL daemon found. Initializing embedded PostgreSQL (PGlite 16)...');
    const { PGlite } = await import('@electric-sql/pglite');
    const dataDir = path.resolve(process.cwd(), '.data/frontdesk-db');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const pgliteInstance = new PGlite(dataDir);
    const runPgliteQuery = async <R = any>(text: string, params?: unknown[]) => {
      if (!params || params.length === 0) {
        const results = await pgliteInstance.exec(text);
        const lastResult = results[results.length - 1];
        return {
          rows: (lastResult?.rows || []) as R[],
          rowCount: lastResult?.rows?.length ?? 0,
        };
      }
      const res = await pgliteInstance.query(text, params as any[]);
      return {
        rows: res.rows as R[],
        rowCount: res.rows?.length ?? 0,
      };
    };

    activeDb = {
      isEmbedded: true,
      query: runPgliteQuery,
      connect: async (): Promise<FrontdeskDbClient> => ({
        query: runPgliteQuery,
        release: () => {},
      }),
      end: async () => {
        await pgliteInstance.close();
      },
    };

    console.log(`Embedded PostgreSQL ready with storage at: ${dataDir}`);
    return activeDb;
  })();

  return initPromise;
}

export const pool = {
  async query<R = any>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount?: number | null }> {
    const db = await getOrInitDb();
    return db.query<R>(text, params);
  },
  async connect(): Promise<FrontdeskDbClient> {
    const db = await getOrInitDb();
    if (typeof db.connect === 'function') {
      return db.connect();
    }
    return {
      query: <R = any>(t: string, p?: unknown[]) => db.query<R>(t, p),
      release: () => {},
    };
  },
  async end() {
    const db = await getOrInitDb();
    if (typeof db.end === 'function') {
      await db.end();
    }
  },
};

export async function query(text: string, params?: unknown[]) {
  return pool.query(text, params);
}

export async function checkDbHealth(): Promise<{ ok: boolean; message?: string; isEmbedded?: boolean }> {
  try {
    const db = await getOrInitDb();
    const res = await db.query('SELECT 1 as healthy');
    if (res.rows[0]?.healthy === 1) {
      return { ok: true, isEmbedded: db.isEmbedded };
    }
    return { ok: false, message: 'Unexpected query result' };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, message: errorMessage };
  }
}
