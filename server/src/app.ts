import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkDbHealth, pool } from './db/connection.js';
import { DbClient } from './db/transaction.js';
import { Clock, SystemClock } from './time/clock.js';
import { createAuthRouter } from './routes/auth.js';
import { createAgentRouter } from './routes/agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(db: DbClient = pool, clock: Clock = new SystemClock()) {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    const dbHealth = await checkDbHealth();
    const isHealthy = dbHealth.ok;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      service: 'frontdesk-backend',
      database: isHealthy ? 'connected' : 'disconnected',
      timestamp: clock.now().toISOString(),
      ...(dbHealth.message ? { dbError: dbHealth.message } : {}),
    });
  });

  // API Routers
  app.use('/api/auth', createAuthRouter(db));
  app.use('/api/agent', createAgentRouter(db, clock));

  // Production: serve built frontend from web/dist
  const candidates = [
    path.resolve(process.cwd(), 'web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(__dirname, '../../../web/dist'),
    path.resolve(__dirname, '../../web/dist'),
  ];

  let webDistPath: string | null = null;
  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.statSync(cand).isDirectory()) {
      webDistPath = cand;
      break;
    }
  }

  if (webDistPath) {
    app.use(express.static(webDistPath));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api') || req.path === '/health') {
        return next();
      }
      res.sendFile(path.join(webDistPath!, 'index.html'));
    });
  }

  return app;
}

export const app = createApp();
