import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, checkDbHealth } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function resolveMigrationsDir(): string {
  // Check common relative paths to locate the migrations directory
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '../migrations'),
    path.resolve(__dirname, '../../../migrations'),
    path.resolve(__dirname, '../../migrations'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }

  throw new Error(`Migrations directory not found in candidates: ${candidates.join(', ')}`);
}

export async function runMigrations(customPool = pool): Promise<string[]> {
  const client = await customPool.connect();
  const applied: string[] = [];

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    // Fetch already applied migrations
    const res = await client.query('SELECT name FROM schema_migrations ORDER BY id ASC;');
    const appliedSet = new Set<string>(res.rows.map((row: { name: string }) => row.name));

    // Find and sort migration files
    const migrationsDir = resolveMigrationsDir();
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    for (const file of files) {
      if (!appliedSet.has(file)) {
        const filePath = path.join(migrationsDir, file);
        const sql = fs.readFileSync(filePath, 'utf-8');

        console.log(`Applying migration: ${file}...`);
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1);', [file]);
          await client.query('COMMIT');
          applied.push(file);
          console.log(`Migration applied successfully: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Error applying migration ${file}:`, err);
          throw err;
        }
      }
    }

    if (applied.length === 0) {
      console.log('No pending migrations.');
    } else {
      console.log(`Applied ${applied.length} migration(s).`);
    }

    return applied;
  } finally {
    client.release();
  }
}

// Execute migration if run directly via CLI
if (process.argv[1] && (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'))) {
  (async () => {
    try {
      console.log('Connecting to database and running migrations...');
      await runMigrations();
      console.log('Migrations complete.');
      process.exit(0);
    } catch (err) {
      console.error('Migration failed:', err);
      process.exit(1);
    }
  })();
}

