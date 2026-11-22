import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { checkDbHealth } from './db/connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

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
    timestamp: new Date().toISOString(),
    ...(dbHealth.message ? { dbError: dbHealth.message } : {}),
  });
});

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

