import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { FakeClock } from '../time/clock.js';
import { createIstDate } from '../time/workingTime.js';
import { signToken } from '../auth/jwt.js';
import { TicketService } from '../domain/ticketService.js';

// In-memory HTTP request dispatcher for Express without port binding
function dispatch(app: any, method: string, url: string, options: { headers?: Record<string, string>; body?: any } = {}) {
  return new Promise<{ status: number; body: any; headers: Record<string, string> }>((resolve) => {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    const parsedUrl = new URL(url, 'http://localhost');

    const req: any = {
      method,
      url,
      path: parsedUrl.pathname,
      query: Object.fromEntries(parsedUrl.searchParams.entries()),
      headers: options.headers || {},
      body: options.body || {},
      get: (header: string) => {
        const val = options.headers?.[header.toLowerCase()];
        if (header.toLowerCase() === 'host') return 'localhost';
        return val;
      },
    };

    const res: any = {
      statusCode: 200,
      status(code: number) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
        return this;
      },
      json(data: any) {
        resolve({ status: statusCode, body: data, headers: responseHeaders });
      },
      send(data: any) {
        resolve({ status: statusCode, body: data, headers: responseHeaders });
      },
      end() {
        resolve({ status: statusCode, body: null, headers: responseHeaders });
      },
    };

    app.handle(req, res);
  });
}

describe('Agent API & Authentication', () => {
  let db: PGlite;
  let fakeClock: FakeClock;
  let app: any;
  let ticketService: TicketService;

  const leadToken = signToken({
    id: 'a0000000-0000-0000-0000-000000000000',
    email: 'lead@arvosystems.com',
    name: 'Lead Supervisor',
    role: 'lead',
  });

  const agent1Token = signToken({
    id: 'a0000000-0000-0000-0000-000000000001',
    email: 'agent1@arvosystems.com',
    name: 'Agent One',
    role: 'agent',
  });

  const agent2Token = signToken({
    id: 'a0000000-0000-0000-0000-000000000002',
    email: 'agent2@arvosystems.com',
    name: 'Agent Two',
    role: 'agent',
  });

  beforeEach(async () => {
    db = new PGlite();

    const baselineSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/001_baseline.sql'), 'utf-8');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/002_schema.sql'), 'utf-8');
    const triggersSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/003_immutability_triggers.sql'), 'utf-8');
    const seedSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/004_seed_users_and_holidays.sql'), 'utf-8');

    await db.exec(baselineSql);
    await db.exec(schemaSql);
    await db.exec(triggersSql);
    await db.exec(seedSql);

    fakeClock = new FakeClock(createIstDate(2026, 11, 23, 10, 0, 0));
    app = createApp(db, fakeClock);
    ticketService = new TicketService(db, fakeClock);
  });

  describe('Authentication (/api/auth)', () => {
    it('logs in successfully with valid credentials', async () => {
      const res = await dispatch(app, 'POST', '/api/auth/login', {
        body: {
          email: 'agent1@arvosystems.com',
          password: 'Password123!',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toMatchObject({
        email: 'agent1@arvosystems.com',
        name: 'Agent One',
        role: 'agent',
      });
    });

    it('rejects invalid password', async () => {
      const res = await dispatch(app, 'POST', '/api/auth/login', {
        body: {
          email: 'agent1@arvosystems.com',
          password: 'WrongPassword!',
        },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/invalid email or password/i);
    });

    it('returns current user via /api/auth/me', async () => {
      const res = await dispatch(app, 'GET', '/api/auth/me', {
        headers: { authorization: `Bearer ${agent1Token}` },
      });

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('agent1@arvosystems.com');
    });
  });

  describe('Authorization Matrix (Agent vs Lead vs Anonymous)', () => {
    it('blocks anonymous access with 401 across /api/agent/*', async () => {
      const protectedEndpoints = [
        ['GET', '/api/agent/tickets'],
        ['GET', '/api/agent/reports/late'],
        ['POST', '/api/agent/tickets/some-id/claim'],
        ['POST', '/api/agent/holidays'],
      ];

      for (const [method, path] of protectedEndpoints) {
        const res = await dispatch(app, method, path);
        expect(res.status).toBe(401);
      }
    });

    it('enforces lead-only permissions on reports and holiday mutations', async () => {
      // Agent accessing lead-only late report -> 403
      const reportRes = await dispatch(app, 'GET', '/api/agent/reports/late', {
        headers: { authorization: `Bearer ${agent1Token}` },
      });
      expect(reportRes.status).toBe(403);

      // Lead accessing late report -> 200
      const leadReportRes = await dispatch(app, 'GET', '/api/agent/reports/late', {
        headers: { authorization: `Bearer ${leadToken}` },
      });
      expect(leadReportRes.status).toBe(200);

      // Agent creating holiday -> 403
      const agentHolidayRes = await dispatch(app, 'POST', '/api/agent/holidays', {
        headers: { authorization: `Bearer ${agent1Token}` },
        body: { holiday_date: '2026-12-31', name: 'New Year Eve' },
      });
      expect(agentHolidayRes.status).toBe(403);

      // Lead creating holiday -> 201
      const leadHolidayRes = await dispatch(app, 'POST', '/api/agent/holidays', {
        headers: { authorization: `Bearer ${leadToken}` },
        body: { holiday_date: '2026-12-31', name: 'New Year Eve' },
      });
      expect(leadHolidayRes.status).toBe(201);
    });
  });

  describe('Atomic Claim & Concurrency (INC-0291, R7)', () => {
    it('handles simultaneous claims: exactly one succeeds with 200, remainder fail with 409', async () => {
      // Create an unassigned ticket
      const ticket = await ticketService.createTicket({
        subject: 'High priority incident',
        description: 'Multiple agents clicking take',
        priority: 'Urgent',
        customer: { name: 'Customer C', email: 'c@example.com' },
      });

      // 5 concurrent claim requests
      const tokens = [
        signToken({ id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent 1', email: 'a1@test.com', role: 'agent' }),
        signToken({ id: 'a0000000-0000-0000-0000-000000000002', name: 'Agent 2', email: 'a2@test.com', role: 'agent' }),
        signToken({ id: 'a0000000-0000-0000-0000-000000000003', name: 'Agent 3', email: 'a3@test.com', role: 'agent' }),
        signToken({ id: 'a0000000-0000-0000-0000-000000000004', name: 'Agent 4', email: 'a4@test.com', role: 'agent' }),
        signToken({ id: 'a0000000-0000-0000-0000-000000000005', name: 'Agent 5', email: 'a5@test.com', role: 'agent' }),
      ];

      const responses = await Promise.all(
        tokens.map((token) =>
          dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/claim`, {
            headers: { authorization: `Bearer ${token}` },
          })
        )
      );

      const successResponses = responses.filter((r) => r.status === 200);
      const conflictResponses = responses.filter((r) => r.status === 409);

      // Exactly ONE claim succeeds!
      expect(successResponses.length).toBe(1);
      // All other concurrent claims fail with 409!
      expect(conflictResponses.length).toBe(4);

      // Conflict response indicates who claimed the ticket
      expect(conflictResponses[0].body.error).toMatch(/already claimed by/i);
    });
  });

  describe('Non-Assignee Restrictions (R7)', () => {
    it('prevents non-assignee agents from replying, noting, or resolving', async () => {
      // Ticket assigned to Agent One
      const ticket = await ticketService.createTicket({
        subject: 'Confidential investigation',
        description: 'Assigned to Agent One',
        priority: 'Medium',
        customer: { name: 'Customer X', email: 'x@example.com' },
      });

      await ticketService.claimTicket(ticket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Agent Two attempts to reply -> 403
      const replyRes = await dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/reply`, {
        headers: { authorization: `Bearer ${agent2Token}` },
        body: { body: 'Unauthorized reply attempt' },
      });
      expect(replyRes.status).toBe(403);

      // Agent Two attempts to add internal note -> 403
      const noteRes = await dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/notes`, {
        headers: { authorization: `Bearer ${agent2Token}` },
        body: { body: 'Unauthorized note attempt' },
      });
      expect(noteRes.status).toBe(403);

      // Agent Two attempts to resolve -> 403
      const resolveRes = await dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/resolve`, {
        headers: { authorization: `Bearer ${agent2Token}` },
      });
      expect(resolveRes.status).toBe(403);

      // Assigned Agent One replies successfully -> 200
      const validReplyRes = await dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/reply`, {
        headers: { authorization: `Bearer ${agent1Token}` },
        body: { body: 'Authorized reply by assigned agent' },
      });
      expect(validReplyRes.status).toBe(200);

      // Lead Supervisor overrides and can reply -> 200
      const leadReplyRes = await dispatch(app, 'POST', `/api/agent/tickets/${ticket.id}/reply`, {
        headers: { authorization: `Bearer ${leadToken}` },
        body: { body: 'Lead supervisor intervention' },
      });
      expect(leadReplyRes.status).toBe(200);
    });
  });

  describe('Validation & Error Handling', () => {
    it('returns 400 on invalid input across endpoints', async () => {
      // Ticket reply with empty body
      const replyRes = await dispatch(app, 'POST', '/api/agent/tickets/any-id/reply', {
        headers: { authorization: `Bearer ${agent1Token}` },
        body: { body: '   ' },
      });
      expect(replyRes.status).toBe(400);

      // Ticket priority with invalid enum
      const prioRes = await dispatch(app, 'POST', '/api/agent/tickets/any-id/priority', {
        headers: { authorization: `Bearer ${agent1Token}` },
        body: { priority: 'SUPER_URGENT' },
      });
      expect(prioRes.status).toBe(400);

      // Holiday with invalid date format
      const holRes = await dispatch(app, 'POST', '/api/agent/holidays', {
        headers: { authorization: `Bearer ${leadToken}` },
        body: { holiday_date: 'invalid-date', name: 'Test' },
      });
      expect(holRes.status).toBe(400);
    });
  });

  describe('CSV Export', () => {
    it('generates CSV export without internal notes (R8)', async () => {
      const ticket = await ticketService.createTicket({
        subject: 'CSV Ticket Test',
        description: 'Customer inquiry body',
        priority: 'Small',
        customer: { name: 'CSV Cust', email: 'csv@example.com' },
      });

      // Add a private note with secret canary
      await ticketService.addInternalNote({
        ticketId: ticket.id,
        author: { id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent One' },
        body: 'SECRET-CANARY-PRIVATE-NOTE',
      });

      const csvRes = await dispatch(app, 'GET', '/api/agent/tickets/export/csv', {
        headers: { authorization: `Bearer ${agent1Token}` },
      });

      expect(csvRes.status).toBe(200);
      expect(csvRes.headers['content-type']).toBe('text/csv');
      expect(csvRes.body).toContain('CSV Ticket Test');
      // Secret internal note MUST NOT be in CSV export!
      expect(csvRes.body).not.toContain('SECRET-CANARY-PRIVATE-NOTE');
    });
  });
});
