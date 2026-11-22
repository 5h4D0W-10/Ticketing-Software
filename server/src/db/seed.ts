import { pool } from './connection.js';

export async function runSeeds(customPool = pool): Promise<void> {
  const client = await customPool.connect();
  try {
    console.log('Running database seeds...');
    // Seed verification check
    await client.query(`
      INSERT INTO system_metadata (key, value)
      VALUES ('seeds_version', '1.0.0')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
    `);
    console.log('Seeds applied successfully.');
  } finally {
    client.release();
  }
}

if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  (async () => {
    try {
      await runSeeds();
      process.exit(0);
    } catch (err) {
      console.error('Seed execution failed:', err);
      process.exit(1);
    }
  })();
}

