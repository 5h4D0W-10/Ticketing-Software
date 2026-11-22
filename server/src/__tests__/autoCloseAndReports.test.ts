import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { createApp } from '../app.js';
import { FakeClock } from '../time/clock.js';
import { createIstDate } from '../time/workingTime.js';
import { signToken } from '../auth/jwt.js';
import { TicketService } from '../domain/ticketService.js';
import { generateLateTicketsReport } from '../domain/reports.js';

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

describe('Auto-Close Sweep (R3), Reopen Window (R4), Late Report (R6)', () => {
  let db: PGlite;
  let fakeClock: FakeClock;
  let app: any;
  let ticketService: TicketService;

  const testHolidays = ['2026-11-25']; // Wednesday holiday

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

    // Initial clock: Friday 2026-11-20 at 16:30 IST
    fakeClock = new FakeClock(createIstDate(2026, 11, 20, 16, 30, 0));
    app = createApp(db, fakeClock);
    ticketService = new TicketService(db, fakeClock, async () => testHolidays);
  });

  describe('Auto-Close Sweep (R3)', () => {
    it('auto-closes ticket after exactly 5 working days (45 working hours) across weekend and holiday', async () => {
      // 1. Create ticket on Friday 2026-11-20 at 16:30 IST
      const ticket = await ticketService.createTicket({
        subject: 'Auto-close test ticket',
        description: 'Waiting on customer input',
        priority: 'Medium',
        customer: { name: 'Silent Customer', email: 'silent@example.com' },
      });

      await ticketService.claimTicket(ticket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Agent replies and enters WAITING_CUSTOMER at Friday 16:30 IST
      await ticketService.addPublicReply({
        ticketId: ticket.id,
        sender: {
          type: 'agent',
          id: 'a0000000-0000-0000-0000-000000000001',
          name: 'Agent One',
        },
        body: 'Can you provide the error screenshot?',
        sendAndWait: true,
      });

      // 45 working hours = 2700 working minutes:
      // Friday 16:30 to 18:30 = 120m
      // Sat Nov 21 & Sun Nov 22 = 0m
      // Mon Nov 23 = 540m (total 660m)
      // Tue Nov 24 = 540m (total 1200m)
      // Wed Nov 25 = 0m (Holiday!)
      // Thu Nov 26 = 540m (total 1740m)
      // Fri Nov 27 = 540m (total 2280m)
      // Sat Nov 28 & Sun Nov 29 = 0m
      // Mon Nov 30: needs 420m (7 hours from 09:30) -> 16:30 IST!

      // Check 1: Exactly 1 minute before threshold (Monday Nov 30 at 16:29 IST)
      fakeClock.set(createIstDate(2026, 11, 30, 16, 29, 0));
      const closedBefore = await ticketService.sweepAutoCloseTickets();
      expect(closedBefore).toEqual([]);

      const checkDbTicket1 = await db.query('SELECT status FROM tickets WHERE id = $1;', [ticket.id]);
      expect(checkDbTicket1.rows[0].status).toBe('WAITING_CUSTOMER');

      // Check 2: At threshold (Monday Nov 30 at 16:30 IST)
      fakeClock.set(createIstDate(2026, 11, 30, 16, 30, 0));
      const closedAtThreshold = await ticketService.sweepAutoCloseTickets();
      expect(closedAtThreshold).toContain(ticket.id);

      const checkDbTicket2 = await db.query('SELECT status, closed_at FROM tickets WHERE id = $1;', [ticket.id]);
      expect(checkDbTicket2.rows[0].status).toBe('CLOSED');
      expect(checkDbTicket2.rows[0].closed_at).toBeDefined();

      // Check auto_closed event
      const eventRes = await db.query(
        "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'auto_closed';",
        [ticket.id]
      );
      expect(eventRes.rows.length).toBe(1);
      expect(eventRes.rows[0].actor_type).toBe('system');
      expect(eventRes.rows[0].actor_name).toBe('system');
    });

    it('sweep is strictly idempotent: running twice yields no duplicates', async () => {
      // Create and wait on customer
      const ticket = await ticketService.createTicket({
        subject: 'Idempotency test ticket',
        description: 'Testing multiple sweep executions',
        priority: 'Small',
        customer: { name: 'Cust', email: 'c@example.com' },
      });

      await ticketService.claimTicket(ticket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      await ticketService.addPublicReply({
        ticketId: ticket.id,
        sender: { type: 'agent', id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent One' },
        body: 'Waiting',
        sendAndWait: true,
      });

      // Advance clock past 5 working days
      fakeClock.advanceDays(14);

      // First sweep: closes ticket
      const sweep1 = await ticketService.sweepAutoCloseTickets();
      expect(sweep1).toContain(ticket.id);

      // Second sweep: does nothing
      const sweep2 = await ticketService.sweepAutoCloseTickets();
      expect(sweep2).not.toContain(ticket.id);

      // Exactly one auto_closed event exists
      const events = await db.query(
        "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'auto_closed';",
        [ticket.id]
      );
      expect(events.rows.length).toBe(1);
    });

    it('does NOT auto-close tickets in NEW or OPEN status', async () => {
      // 1 ticket in NEW
      const newTicket = await ticketService.createTicket({
        subject: 'New Ticket',
        description: 'Unassigned',
        priority: 'Medium',
        customer: { name: 'New Cust', email: 'new@example.com' },
      });

      // 1 ticket in OPEN
      const openTicket = await ticketService.createTicket({
        subject: 'Open Ticket',
        description: 'Assigned',
        priority: 'Medium',
        customer: { name: 'Open Cust', email: 'open@example.com' },
      });
      await ticketService.claimTicket(openTicket.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Advance clock 2 weeks
      fakeClock.advanceDays(14);

      const closed = await ticketService.sweepAutoCloseTickets();
      expect(closed).toEqual([]);

      const resNew = await db.query('SELECT status FROM tickets WHERE id = $1;', [newTicket.id]);
      expect(resNew.rows[0].status).toBe('NEW');

      const resOpen = await db.query('SELECT status FROM tickets WHERE id = $1;', [openTicket.id]);
      expect(resOpen.rows[0].status).toBe('OPEN');
    });

    it('triggers sweep via protected POST /api/internal/sweep', async () => {
      // Unauthorized call without secret -> 401
      const unauthRes = await dispatch(app, 'POST', '/api/internal/sweep');
      expect(unauthRes.status).toBe(401);

      // Authorized call with secret header -> 200
      const authRes = await dispatch(app, 'POST', '/api/internal/sweep', {
        headers: {
          'x-internal-secret': 'frontdesk-internal-sweep-secret-key-arvo-2026',
        },
      });
      expect(authRes.status).toBe(200);
      expect(authRes.body.success).toBe(true);
      expect(typeof authRes.body.closedCount).toBe('number');
    });
  });

  describe('Reopen (R4) & Follow-Up Creation', () => {
    it('allows reopen within window, increments cycle, and resets SLA deadlines', async () => {
      const ticket = await ticketService.createTicket({
        subject: 'Reopen SLA cycle test',
        description: 'Ticket to be resolved then reopened',
        priority: 'Medium',
        customer: { name: 'Customer R', email: 'r@example.com' },
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

      // Advance clock 1 working day (540m)
      fakeClock.set(createIstDate(2026, 11, 23, 11, 0, 0));

      const reopenRes = await dispatch(app, 'POST', `/api/customer/tickets/${ticket.public_token}/reopen`);
      expect(reopenRes.status).toBe(200);
      expect(reopenRes.body.ticket.status).toBe('OPEN');

      const updated = await db.query('SELECT * FROM tickets WHERE id = $1;', [ticket.id]);
      const reopenedTicket = updated.rows[0];

      // Cycle incremented
      expect(reopenedTicket.cycle).toBe(2);
      expect(reopenedTicket.first_response_at).toBeNull();
      expect(reopenedTicket.resolved_at).toBeNull();

      // New clock start matches reopen time (Monday 11:00 IST)
      expect(new Date(reopenedTicket.clock_start).toISOString()).toBe(
        createIstDate(2026, 11, 23, 11, 0, 0).toISOString()
      );
      // Medium first response: 270m from Monday 11:00 -> Monday 15:30 IST
      expect(new Date(reopenedTicket.response_due_at).toISOString()).toBe(
        createIstDate(2026, 11, 23, 15, 30, 0).toISOString()
      );
    });

    it('rejects reopen after 5 working days and provides pre-filled follow-up ticket info', async () => {
      const ticket = await ticketService.createTicket({
        subject: 'Printer issue',
        description: 'Printer cannot connect',
        priority: 'Small',
        customer: { name: 'Customer Late', email: 'late@example.com' },
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

      // Advance clock 7 working days (> 5 working days)
      fakeClock.advanceDays(12);

      const reopenRes = await dispatch(app, 'POST', `/api/customer/tickets/${ticket.public_token}/reopen`);
      expect(reopenRes.status).toBe(400);
      expect(reopenRes.body.expired).toBe(true);
      expect(reopenRes.body.canFollowUp).toBe(true);
      expect(reopenRes.body.followUp.parentTicketId).toBe(ticket.id);
      expect(reopenRes.body.followUp.subject).toBe('Follow-up: Printer issue');

      // Now create follow-up ticket linking parent_ticket_id
      const followUpRes = await dispatch(app, 'POST', '/api/customer/tickets', {
        body: {
          name: 'Customer Late',
          email: 'late@example.com',
          subject: reopenRes.body.followUp.subject,
          description: 'The issue returned. Following up on previous ticket.',
          urgency: 'Question or small request',
          parentTicketId: reopenRes.body.followUp.parentTicketId,
        },
      });

      expect(followUpRes.status).toBe(201);
      const newTicketRes = await db.query('SELECT parent_ticket_id FROM tickets WHERE public_token = $1;', [
        followUpRes.body.ticket.token,
      ]);
      expect(newTicketRes.rows[0].parent_ticket_id).toBe(ticket.id);
    });
  });

  describe('Late Tickets Report Reasons (R6)', () => {
    it('generates exact computed reasons for seeded late ticket scenarios', async () => {
      // Start at Monday 2026-11-23 at 09:30 AM IST
      fakeClock.set(createIstDate(2026, 11, 23, 9, 30, 0));

      // Scenario 1: Claim delay of 3 hours 10 minutes (190m)
      const ticket1 = await ticketService.createTicket({
        subject: 'Claim delay scenario',
        description: 'Incident INC-0291 scenario',
        priority: 'Urgent',
        customer: { name: 'Scenario 1', email: 's1@example.com' },
      });

      // Advance 190 minutes (to 12:40 IST) before claiming
      fakeClock.set(createIstDate(2026, 11, 23, 12, 40, 0));
      await ticketService.claimTicket(ticket1.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Scenario 2: First reply 45 working min after deadline
      // Urgent response deadline was 11:30 IST. Agent replies 45m late at 12:15 IST.
      fakeClock.set(createIstDate(2026, 11, 23, 9, 30, 0));
      const ticket2 = await ticketService.createTicket({
        subject: 'First reply breach scenario',
        description: 'First reply was late',
        priority: 'Urgent', // Response due at 11:30 IST (starts 09:30)
        customer: { name: 'Scenario 2', email: 's2@example.com' },
      });
      await ticketService.claimTicket(ticket2.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });
      // Reply at 12:15 IST (45m after 11:30 deadline)
      fakeClock.set(createIstDate(2026, 11, 23, 12, 15, 0));
      await ticketService.addPublicReply({
        ticketId: ticket2.id,
        sender: { type: 'agent', id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent One' },
        body: 'Replying now',
      });

      // Scenario 3: Resolution overdue by 1 working day (540m)
      // Urgent resolution was due Monday 18:30 IST. Resolved Tuesday 18:30 IST (1 working day late).
      fakeClock.set(createIstDate(2026, 11, 23, 9, 30, 0));
      const ticket3 = await ticketService.createTicket({
        subject: 'Resolution overdue scenario',
        description: 'Resolution took extra day',
        priority: 'Urgent',
        customer: { name: 'Scenario 3', email: 's3@example.com' },
      });
      await ticketService.claimTicket(ticket3.id, {
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });
      // Reply on time
      fakeClock.set(createIstDate(2026, 11, 23, 10, 30, 0));
      await ticketService.addPublicReply({
        ticketId: ticket3.id,
        sender: { type: 'agent', id: 'a0000000-0000-0000-0000-000000000001', name: 'Agent One' },
        body: 'On time reply',
        sendAndWait: true, // Pauses for 2 working hours
      });

      // Customer resumes 2 hours later at 12:30 IST (120m excluded)
      fakeClock.set(createIstDate(2026, 11, 23, 12, 30, 0));
      await ticketService.addPublicReply({
        ticketId: ticket3.id,
        sender: { type: 'customer', name: 'Scenario 3' },
        body: 'Resumed',
      });

      // Resolve on Wednesday morning: resolution overdue by 1 working day
      fakeClock.set(createIstDate(2026, 11, 24, 18, 30, 0));
      await ticketService.resolveTicket(ticket3.id, {
        type: 'agent',
        id: 'a0000000-0000-0000-0000-000000000001',
        name: 'Agent One',
      });

      // Generate report as Lead
      const report = await generateLateTicketsReport(
        db,
        ticketService,
        createIstDate(2026, 11, 24, 18, 30, 0),
        testHolidays
      );

      // Verify Scenario 1 has claim delay reason
      const item1 = report.find((r) => r.id === ticket1.id);
      expect(item1).toBeDefined();
      expect(item1!.reasons.some((r) => r.includes('not claimed for 3h10m'))).toBe(true);

      // Verify Scenario 2 has first reply late reason
      const item2 = report.find((r) => r.id === ticket2.id);
      expect(item2).toBeDefined();
      expect(item2!.reasons.some((r) => r.includes('first reply 45 working min after deadline'))).toBe(true);

      // Verify Scenario 3 has resolution overdue reason and customer waiting time excluded
      const item3 = report.find((r) => r.id === ticket3.id);
      expect(item3).toBeDefined();
      expect(item3!.reasons.some((r) => r.includes('resolution overdue'))).toBe(true);
      expect(item3!.excludedCustomerWaitingMinutes).toBe(120);
      expect(item3!.excludedCustomerWaitingFormatted).toBe('2h');
    });
  });
});

