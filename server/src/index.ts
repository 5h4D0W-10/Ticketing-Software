import dotenv from 'dotenv';
import { app } from './app.js';
import { pool, checkDbHealth } from './db/connection.js';
import { runMigrations } from './db/migrate.js';
import { runSeeds } from './db/seed.js';
import { TicketService } from './domain/ticketService.js';
import { initScheduler } from './cron/scheduler.js';

dotenv.config();

function validateEnvironment(): void {
  const isProd = process.env.NODE_ENV === 'production';

  if (!process.env.DATABASE_URL) {
    if (isProd) {
      console.warn('⚠️  [Production Warning] DATABASE_URL is not set. Falling back to default connection settings.');
    } else {
      console.log('ℹ️  DATABASE_URL not set; using local PostgreSQL connection parameters.');
    }
  }

  if (!process.env.JWT_SECRET) {
    if (isProd) {
      console.warn('⚠️  [Production Warning] JWT_SECRET is not set in production. Please set JWT_SECRET for production security.');
    }
  }

  if (!process.env.INTERNAL_SECRET) {
    console.log('ℹ️  INTERNAL_SECRET not set; using default secret for internal sweep trigger.');
  }
}

async function bootstrap() {
  validateEnvironment();

  const PORT = Number(process.env.PORT) || 3000;

  // 1. Database Connection & Startup Migrations/Seeds
  const dbHealth = await checkDbHealth();
  if (dbHealth.ok) {
    console.log('Connected to PostgreSQL successfully.');
    try {
      console.log('Running pending database migrations...');
      const applied = await runMigrations();
      console.log(`Migrations complete. (${applied.length} applied)`);

      console.log('Checking database seeds (idempotent, seeds only if empty)...');
      await runSeeds();
    } catch (err) {
      console.error('Migration or Seed error during startup:', err);
    }
  } else {
    console.warn(`PostgreSQL connection check failed (${dbHealth.message}). Starting in degraded mode; /health will report 503.`);
  }

  // 2. Initialize Periodic Background Scheduler (Cron)
  const ticketService = new TicketService(pool);
  const scheduler = initScheduler(ticketService);

  // 3. Start Express HTTP Server
  const server = app.listen(PORT, () => {
    console.log(`Frontdesk production server running on port ${PORT}`);
    console.log(`Health endpoint: http://localhost:${PORT}/health`);
  });

  // 4. Graceful Shutdown Handlers
  const shutdown = async () => {
    console.log('\nShutting down Frontdesk gracefully...');
    scheduler.stop();
    server.close(async () => {
      await pool.end();
      console.log('Database connections closed. Goodbye.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error in Frontdesk:', err);
  process.exit(1);
});
