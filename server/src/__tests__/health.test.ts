import { describe, it, expect, vi } from 'vitest';
import * as dbModule from '../db/connection.js';
import { app } from '../app.js';

// Lightweight request dispatcher for testing Express routes in sandbox
async function simulateRequest(method: string, path: string) {
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    let statusCode = 200;
    const req = {
      method,
      url: path,
      path,
      headers: {},
      get: (header: string) => (header.toLowerCase() === 'host' ? 'localhost' : undefined),
    };
    const res = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      json(data: Record<string, unknown>) {
        resolve({ status: statusCode, body: data });
      },
      setHeader() {
        return this;
      },
      end() {
        resolve({ status: statusCode, body: {} });
      },
    };

    (app as unknown as { handle: (req: unknown, res: unknown) => void }).handle(req, res);
  });
}

describe('GET /health', () => {
  it('returns status ok when DB is connected', async () => {
    vi.spyOn(dbModule, 'checkDbHealth').mockResolvedValueOnce({ ok: true });

    const response = await simulateRequest('GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'frontdesk-backend',
      database: 'connected',
    });
    expect(response.body.timestamp).toBeDefined();
  });

  it('returns degraded status when DB is disconnected', async () => {
    vi.spyOn(dbModule, 'checkDbHealth').mockResolvedValueOnce({
      ok: false,
      message: 'Connection refused',
    });

    const response = await simulateRequest('GET', '/health');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'degraded',
      service: 'frontdesk-backend',
      database: 'disconnected',
      dbError: 'Connection refused',
    });
  });
});
