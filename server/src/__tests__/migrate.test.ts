import { describe, it, expect, vi } from 'vitest';
import { resolveMigrationsDir, runMigrations } from '../db/migrate.js';
import fs from 'fs';

describe('Migration runner', () => {
  it('finds the migrations directory with SQL files', () => {
    const dir = resolveMigrationsDir();
    expect(fs.existsSync(dir)).toBe(true);

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('001_baseline.sql');
    expect(files).toContain('002_schema.sql');
    expect(files).toContain('003_immutability_triggers.sql');
  });

  it('applies unapplied migrations and records them in schema_migrations', async () => {
    const executedQueries: string[] = [];
    const queryParams: unknown[][] = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        executedQueries.push(sql);
        if (params) queryParams.push(params);

        if (sql.includes('SELECT name FROM schema_migrations')) {
          return { rows: [] }; // No migrations applied yet
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as import('pg').Pool;

    const applied = await runMigrations(mockPool);

    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
    expect(applied).toContain('001_baseline.sql');
    expect(applied).toContain('002_schema.sql');
    expect(applied).toContain('003_immutability_triggers.sql');

    // Verifies schema_migrations table creation
    expect(
      executedQueries.some((q) => q.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))
    ).toBe(true);

    // Verifies transaction BEGIN / COMMIT
    expect(executedQueries).toContain('BEGIN');
    expect(executedQueries).toContain('COMMIT');

    // Verifies recording of migration
    expect(
      executedQueries.some((q) => q.includes('INSERT INTO schema_migrations (name) VALUES ($1)'))
    ).toBe(true);
  });

  it('skips already applied migrations', async () => {
    const dir = resolveMigrationsDir();
    const allFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));

    const mockClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT name FROM schema_migrations')) {
          return { rows: allFiles.map((name) => ({ name })) }; // All migrations already applied
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    };

    const mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    } as unknown as import('pg').Pool;

    const applied = await runMigrations(mockPool);
    expect(applied).toEqual([]);
  });
});
