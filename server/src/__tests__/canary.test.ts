import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { FakeClock } from '../time/clock.js';
import { createIstDate } from '../time/workingTime.js';
import { signToken } from '../auth/jwt.js';
import { TicketService } from '../domain/ticketService.js';

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
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      unpipe: () => {},
      on: () => req,
      resume: () => req,
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

describe('Private-Note Separation & Canary Guarantee (INC-0304, R8)', () => {
  let db: PGlite;
  let fakeClock: FakeClock;
  let app: any;
  let ticketService: TicketService;

  const CANARY_STRING = 'SECRET-CANARY-123';

  const agentToken = signToken({
    id: 'a0000000-0000-0000-0000-000000000001',
    email: 'agent1@arvosystems.com',
    name: 'Agent One',
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

  it('CANARY TEST: secret canary never appears in any customer-reachable endpoint or error', async () => {
    // 1. Create a customer ticket
    const ticket = await ticketService.createTicket({
      subject: 'Security evaluation ticket',
      description: 'Customer inquiry for testing data leak prevention',
      priority: 'Medium',
      customer: { name: 'Alice Customer', email: 'alice@example.com' },
    });

    // 2. Add confidential internal team note containing the canary string
    await ticketService.addInternalNote({
      ticketId: ticket.id,
      author: { id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent One' },
      body: `CONFIDENTIAL: Customer credit card refund issue. Canary: ${CANARY_STRING}`,
    });

    // 3. Add public agent response so conversation is non-trivial
    await ticketService.addPublicReply({
      ticketId: ticket.id,
      sender: {
        type: 'agent',
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      },
      body: 'Hello Alice, we are investigating your account.',
    });

    const token = ticket.public_token;

    // Helper to assert no canary in body or headers
    function assertNoCanary(res: { status: number; body: any; headers: Record<string, string> }, context: string) {
      const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      const headersStr = JSON.stringify(res.headers);

      expect(bodyStr, `Canary leaked into body on ${context}`).not.toContain(CANARY_STRING);
      expect(headersStr, `Canary leaked into headers on ${context}`).not.toContain(CANARY_STRING);
    }

    // --- HIT EVERY CUSTOMER-REACHABLE ENDPOINT ---

    // 1) Customer ticket detail by token
    const detailRes = await dispatch(app, 'GET', `/api/customer/tickets/${token}`);
    expect(detailRes.status).toBe(200);
    assertNoCanary(detailRes, 'GET /api/customer/tickets/:token');

    // 2) Customer public reply
    const replyRes = await dispatch(app, 'POST', `/api/customer/tickets/${token}/reply`, {
      body: { body: 'Thank you for following up.' },
    });
    expect(replyRes.status).toBe(200);
    assertNoCanary(replyRes, 'POST /api/customer/tickets/:token/reply');

    // 3) Customer JSON export
    const exportJsonRes = await dispatch(app, 'GET', `/api/customer/tickets/${token}/export?format=json`);
    expect(exportJsonRes.status).toBe(200);
    assertNoCanary(exportJsonRes, 'GET /api/customer/tickets/:token/export (json)');

    // 4) Customer CSV export
    const exportCsvRes = await dispatch(app, 'GET', `/api/customer/tickets/${token}/export?format=csv`);
    expect(exportCsvRes.status).toBe(200);
    assertNoCanary(exportCsvRes, 'GET /api/customer/tickets/:token/export (csv)');

    // 5) Customer create new ticket
    const createRes = await dispatch(app, 'POST', '/api/customer/tickets', {
      body: {
        name: 'Bob',
        email: 'bob@example.com',
        subject: 'Another query',
        description: 'New ticket body',
        urgency: 'Medium',
      },
    });
    expect(createRes.status).toBe(201);
    assertNoCanary(createRes, 'POST /api/customer/tickets');

    // --- HIT CUSTOMER ERROR CASES ---

    // 6) 404 on invalid token
    const err404Res = await dispatch(app, 'GET', '/api/customer/tickets/invalid-nonexistent-token-xyz');
    expect(err404Res.status).toBe(404);
    assertNoCanary(err404Res, 'GET /api/customer/tickets/:invalidToken (404)');

    // 7) 404 on reply to invalid token
    const errReply404 = await dispatch(app, 'POST', '/api/customer/tickets/invalid-token-xyz/reply', {
      body: { body: 'Some reply' },
    });
    expect(errReply404.status).toBe(404);
    assertNoCanary(errReply404, 'POST /api/customer/tickets/:invalidToken/reply (404)');

    // 8) 404 on reopen invalid token
    const errReopen404 = await dispatch(app, 'POST', '/api/customer/tickets/invalid-token-xyz/reopen');
    expect(errReopen404.status).toBe(404);
    assertNoCanary(errReopen404, 'POST /api/customer/tickets/:invalidToken/reopen (404)');

    // 9) 400 on empty reply
    const errReply400 = await dispatch(app, 'POST', `/api/customer/tickets/${token}/reply`, {
      body: { body: '' },
    });
    expect(errReply400.status).toBe(400);
    assertNoCanary(errReply400, 'POST /api/customer/tickets/:token/reply (400)');

    // 10) 400 on reopen when ticket is OPEN (not yet resolved)
    const errReopen400 = await dispatch(app, 'POST', `/api/customer/tickets/${token}/reopen`);
    expect(errReopen400.status).toBe(400);
    assertNoCanary(errReopen400, 'POST /api/customer/tickets/:token/reopen (400)');

    // --- VERIFY POSITIVE ACCESS: ONLY AUTHENTICATED AGENTS CAN SEE THE CANARY ---

    // 11) Authenticated agent viewing ticket detail DOES see the note
    const agentDetailRes = await dispatch(app, 'GET', `/api/agent/tickets/${ticket.id}`, {
      headers: { authorization: `Bearer ${agentToken}` },
    });
    expect(agentDetailRes.status).toBe(200);
    expect(JSON.stringify(agentDetailRes.body)).toContain(CANARY_STRING);

    // 12) Anonymous user accessing agent ticket detail is blocked with 401
    const unauthAgentRes = await dispatch(app, 'GET', `/api/agent/tickets/${ticket.id}`);
    expect(unauthAgentRes.status).toBe(401);
    expect(JSON.stringify(unauthAgentRes.body)).not.toContain(CANARY_STRING);
  });

  describe('Customer Reopen (R4)', () => {
    it('allows reopen within 5 working days and starts new SLA cycle', async () => {
      // Create and resolve ticket
      const ticket = await ticketService.createTicket({
        subject: 'Reopen test ticket',
        description: 'Testing customer reopen',
        priority: 'Medium',
        customer: { name: 'Reopen Cust', email: 'reopen@example.com' },
      });

      await ticketService.claimTicket(ticket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      await ticketService.resolveTicket(ticket.id, {
        type: 'agent',
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Customer reopens 2 working hours later
      fakeClock.advanceHours(2);

      const reopenRes = await dispatch(app, 'POST', `/api/customer/tickets/${ticket.public_token}/reopen`);
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.ticket.status).toBe('OPEN');

      // Verify cycle incremented in database
      const dbTicketRes = await db.query('SELECT cycle, status FROM tickets WHERE id = $1;', [ticket.id]);
      expect(dbTicketRes.rows[0].cycle).toBe(2);
      expect(dbTicketRes.rows[0].status).toBe('OPEN');
    });

    it('rejects reopen after 5 working days with clear explanation and records reopen_rejected event', async () => {
      const ticket = await ticketService.createTicket({
        subject: 'Expired reopen test',
        description: 'Testing reopen window expiry',
        priority: 'Small',
        customer: { name: 'Late Cust', email: 'late@example.com' },
      });

      await ticketService.claimTicket(ticket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      await ticketService.resolveTicket(ticket.id, {
        type: 'agent',
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Advance clock past 5 working days (advance 8 calendar days across weekend)
      fakeClock.advanceDays(8);

      const reopenRes = await dispatch(app, 'POST', `/api/customer/tickets/${ticket.public_token}/reopen`);
      expect(reopenRes.status).toBe(400);
      expect(reopenRes.body.expired).toBe(true);
      expect(reopenRes.body.error).toMatch(/reopen window.*expired/i);

      // Verify reopen_rejected audit event recorded
      const eventRes = await db.query(
        "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'reopen_rejected';",
        [ticket.id]
      );
      expect(eventRes.rows.length).toBe(1);
    });
  });
});
