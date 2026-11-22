import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import * as dbModule from '../db/connection.js';
import { app } from '../app.js';

describe('GET /health', () => {
  it('returns status ok when DB is connected', async () => {
    vi.spyOn(dbModule, 'checkDbHealth').mockResolvedValueOnce({ ok: true });

    const response = await request(app).get('/health');
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

    const response = await request(app).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      status: 'degraded',
      service: 'frontdesk-backend',
      database: 'disconnected',
      dbError: 'Connection refused',
    });
  });
});

