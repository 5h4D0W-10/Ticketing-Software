import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { FakeClock } from '../time/clock.js';
import { createIstDate, addWorkingMinutes } from '../time/workingTime.js';
import { TicketService } from '../domain/ticketService.js';
import { TicketRow, TicketEventRow, SlaPauseRow } from '../domain/types.js';

describe('Ticket Domain Logic & Lifecycle Service', () => {
  let db: PGlite;
  let fakeClock: FakeClock;
  let service: TicketService;

  const testHolidays = ['2026-11-25']; // Wednesday holiday

  beforeEach(async () => {
    db = new PGlite();

    const baselineSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/001_baseline.sql'), 'utf-8');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/002_schema.sql'), 'utf-8');
    const triggersSql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/003_immutability_triggers.sql'), 'utf-8');

    await db.exec(baselineSql);
    await db.exec(schemaSql);
    await db.exec(triggersSql);

    // Seed test agent and holidays
    await db.query(`
      INSERT INTO users (id, name, email, password_hash, role)
      VALUES
        ('11111111-1111-1111-1111-111111111111', 'Agent Alice', 'alice@arvosystems.com', 'hash', 'agent'),
        ('22222222-2222-2222-2222-222222222222', 'Agent Bob', 'bob@arvosystems.com', 'hash', 'agent');
    `);

    await db.query(`
      INSERT INTO holidays (holiday_date, name)
      VALUES ('2026-11-25', 'Test Festival Holiday');
    `);

    // Clock set to Monday 2026-11-23 at 10:00 AM IST
    fakeClock = new FakeClock(createIstDate(2026, 11, 23, 10, 0, 0));
    service = new TicketService(db, fakeClock, async () => testHolidays);
  });

  it('creates a ticket with calculated deadlines, message, and audit event in ONE transaction', async () => {
    const ticket = await service.createTicket({
      subject: 'Server is completely down',
      description: 'Cannot access dashboard',
      priority: 'Urgent',
      customer: {
        name: 'John Doe',
        email: 'john@example.com',
      },
    });

    expect(ticket.id).toBeDefined();
    expect(ticket.status).toBe('NEW');
    expect(ticket.priority).toBe('Urgent');

    // First response due 2 working hours later (12:00 IST)
    expect(new Date(ticket.response_due_at).toISOString()).toBe(
      createIstDate(2026, 11, 23, 12, 0, 0).toISOString()
    );
    // Resolution due same day at 18:30 IST
    expect(new Date(ticket.resolution_due_at).toISOString()).toBe(
      createIstDate(2026, 11, 23, 18, 30, 0).toISOString()
    );

    // Initial message recorded in messages table
    const msgRes = await db.query('SELECT * FROM messages WHERE ticket_id = $1;', [ticket.id]);
    expect(msgRes.rows.length).toBe(1);
    expect(msgRes.rows[0].body).toBe('Cannot access dashboard');
    expect(msgRes.rows[0].sender_type).toBe('customer');

    // ticket_created event recorded
    const eventRes = await db.query<TicketEventRow>(
      'SELECT * FROM ticket_events WHERE ticket_id = $1;',
      [ticket.id]
    );
    expect(eventRes.rows.length).toBe(1);
    expect(eventRes.rows[0].event_type).toBe('ticket_created');
    expect(eventRes.rows[0].actor_type).toBe('customer');
    expect(eventRes.rows[0].actor_name).toBe('John Doe');
  });

  it('tracks first public agent reply and detects late first response', async () => {
    // Ticket created Monday at 10:00 IST as Urgent (due 12:00 IST)
    const ticket = await service.createTicket({
      subject: 'Urgent issue',
      description: 'Help needed',
      priority: 'Urgent',
      customer: { name: 'Customer A', email: 'a@example.com' },
    });

    // Claim ticket
    await service.claimTicket(ticket.id, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent Alice',
    });

    // Advance clock past deadline: to Monday 12:30 IST (30 working min late)
    fakeClock.set(createIstDate(2026, 11, 23, 12, 30, 0));

    // Agent replies publicly
    const replyResult = await service.addPublicReply({
      ticketId: ticket.id,
      sender: {
        type: 'agent',
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Agent Alice',
      },
      body: 'Looking into this now.',
    });

    expect(replyResult.ticket.first_response_at).toBeDefined();
    expect(replyResult.ticket.first_response_breached).toBe(true);

    // Check breach event
    const breachEvent = await db.query<TicketEventRow>(
      "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'sla_breached';",
      [ticket.id]
    );
    expect(breachEvent.rows.length).toBe(1);
    expect(breachEvent.rows[0].payload.milestone).toBe('first_response');
  });

  it('pauses SLA across a weekend and shifts deadlines on customer resume', async () => {
    // Friday 2026-11-20 at 16:30 IST
    fakeClock.set(createIstDate(2026, 11, 20, 16, 30, 0));

    const ticket = await service.createTicket({
      subject: 'Need assistance',
      description: 'Setup query',
      priority: 'Medium', // 270m response (due Monday 11:00 IST)
      customer: { name: 'Weekend Cust', email: 'cust@weekend.com' },
    });

    await service.claimTicket(ticket.id, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent Alice',
    });

    // Friday 17:30 IST: Agent sends & waits for customer
    fakeClock.set(createIstDate(2026, 11, 20, 17, 30, 0));
    const pauseResult = await service.addPublicReply({
      ticketId: ticket.id,
      sender: {
        type: 'agent',
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Agent Alice',
      },
      body: 'Could you provide your account number?',
      sendAndWait: true,
    });

    expect(pauseResult.ticket.status).toBe('WAITING_CUSTOMER');

    // Original response deadline was Monday 11:00 IST
    const originalResponseDueAt = new Date(ticket.response_due_at);

    // Advance clock through the weekend to Monday 10:30 IST
    fakeClock.set(createIstDate(2026, 11, 23, 10, 30, 0));

    // Customer replies on Monday morning
    const resumeResult = await service.addPublicReply({
      ticketId: ticket.id,
      sender: {
        type: 'customer',
        name: 'Weekend Cust',
      },
      body: 'My account number is 12345.',
    });

    expect(resumeResult.ticket.status).toBe('OPEN');

    // Working minutes paused:
    // Friday: 17:30 to 18:30 = 60 working minutes
    // Saturday & Sunday = 0
    // Monday: 09:30 to 10:30 = 60 working minutes
    // Total paused = 120 working minutes (2 working hours)
    const pauseRecord = await db.query<SlaPauseRow>(
      'SELECT * FROM sla_pauses WHERE ticket_id = $1;',
      [ticket.id]
    );
    expect(pauseRecord.rows.length).toBe(1);
    expect(pauseRecord.rows[0].working_minutes_paused).toBe(120);

    // Resolution deadline was unmet, so it shifted forward by 120 working minutes:
    const originalResolutionDue = new Date(ticket.resolution_due_at);
    const expectedShiftedResolution = addWorkingMinutes(originalResolutionDue, 120, testHolidays);
    expect(new Date(resumeResult.ticket.resolution_due_at).toISOString()).toBe(
      expectedShiftedResolution.toISOString()
    );

    // sla_resumed event recorded
    const resumeEvent = await db.query<TicketEventRow>(
      "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'sla_resumed';",
      [ticket.id]
    );
    expect(resumeEvent.rows.length).toBe(1);
    expect(resumeEvent.rows[0].actor_type).toBe('customer');
  });

  it('pauses SLA across a holiday correctly', async () => {
    // Tuesday 2026-11-24 at 17:00 IST
    fakeClock.set(createIstDate(2026, 11, 24, 17, 0, 0));

    const ticket = await service.createTicket({
      subject: 'Holiday Ticket',
      description: 'Testing holiday pause',
      priority: 'Medium',
      customer: { name: 'Holiday User', email: 'hol@example.com' },
    });

    await service.claimTicket(ticket.id, {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent Alice',
    });

    // Agent pauses at Tuesday 17:00 IST
    await service.addPublicReply({
      ticketId: ticket.id,
      sender: {
        type: 'agent',
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Agent Alice',
      },
      body: 'Need more info',
      sendAndWait: true,
    });

    // Wednesday 2026-11-25 is a holiday. Customer replies Thursday 2026-11-26 at 10:30 IST.
    fakeClock.set(createIstDate(2026, 11, 26, 10, 30, 0));

    const resumeResult = await service.addPublicReply({
      ticketId: ticket.id,
      sender: { type: 'customer', name: 'Holiday User' },
      body: 'Here is the info',
    });

    // Working minutes paused:
    // Tuesday 17:00 to 18:30 = 90 min
    // Wednesday (holiday) = 0 min
    // Thursday 09:30 to 10:30 = 60 min
    // Total = 150 working minutes
    const pauseRecord = await db.query<SlaPauseRow>(
      'SELECT * FROM sla_pauses WHERE ticket_id = $1;',
      [ticket.id]
    );
    expect(pauseRecord.rows[0].working_minutes_paused).toBe(150);
  });

  it('handles priority upgrade and downgrade with recompute rule (R5)', async () => {
    // Ticket created Monday 10:00 IST as Medium
    fakeClock.set(createIstDate(2026, 11, 23, 10, 0, 0));
    const ticket = await service.createTicket({
      subject: 'Priority change test',
      description: 'Details',
      priority: 'Medium',
      customer: { name: 'Customer P', email: 'p@example.com' },
    });

    // Upgrade to Urgent
    const upgraded = await service.changePriority(ticket.id, 'Urgent', {
      type: 'agent',
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent Alice',
    });

    expect(upgraded.priority).toBe('Urgent');
    // Response due recomputed from Monday 10:00 + 120m -> Monday 12:00 IST
    expect(new Date(upgraded.response_due_at).toISOString()).toBe(
      createIstDate(2026, 11, 23, 12, 0, 0).toISOString()
    );
    // Resolution due same day 18:30 IST
    expect(new Date(upgraded.resolution_due_at).toISOString()).toBe(
      createIstDate(2026, 11, 23, 18, 30, 0).toISOString()
    );

    // Priority changed event recorded
    const eventRes = await db.query<TicketEventRow>(
      "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'priority_changed';",
      [ticket.id]
    );
    expect(eventRes.rows.length).toBe(1);
    expect(eventRes.rows[0].payload.oldPriority).toBe('Medium');
    expect(eventRes.rows[0].payload.newPriority).toBe('Urgent');

    // Downgrade to Small
    const downgraded = await service.changePriority(ticket.id, 'Small', {
      type: 'agent',
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Agent Alice',
    });

    expect(downgraded.priority).toBe('Small');
    // Small response: Monday 10:00 + 540m (9 working hours: 510m Mon + 30m Tue) -> Tuesday 10:00 IST
    expect(new Date(downgraded.response_due_at).toISOString()).toBe(
      createIstDate(2026, 11, 24, 10, 0, 0).toISOString()
    );
  });

  it('records sticky sla_breached events idempotently', async () => {
    // Ticket created Monday 10:00 IST as Urgent (response due 12:00 IST)
    fakeClock.set(createIstDate(2026, 11, 23, 10, 0, 0));
    const ticket = await service.createTicket({
      subject: 'Sticky breach test',
      description: 'Breach check',
      priority: 'Urgent',
      customer: { name: 'Customer B', email: 'b@example.com' },
    });

    // Advance clock past response deadline to 12:15 IST
    fakeClock.set(createIstDate(2026, 11, 23, 12, 15, 0));

    // First breach check
    const breached = await service.checkAndRecordBreaches(ticket.id);
    expect(breached.first_response_breached).toBe(true);

    const events1 = await db.query<TicketEventRow>(
      "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'sla_breached';",
      [ticket.id]
    );
    expect(events1.rows.length).toBe(1);

    // Second breach check at 13:00 IST (idempotent, must not duplicate)
    fakeClock.set(createIstDate(2026, 11, 23, 13, 0, 0));
    await service.checkAndRecordBreaches(ticket.id);

    const events2 = await db.query<TicketEventRow>(
      "SELECT * FROM ticket_events WHERE ticket_id = $1 AND event_type = 'sla_breached';",
      [ticket.id]
    );
    expect(events2.rows.length).toBe(1); // Still exactly one breach event
  });

  it('computes late status and remaining working time accurately', async () => {
    // Ticket created Monday 10:00 IST as Medium (response due 270m later = 14:30 IST)
    fakeClock.set(createIstDate(2026, 11, 23, 10, 0, 0));
    const ticket = await service.createTicket({
      subject: 'SLA Status Test',
      description: 'Status check',
      priority: 'Medium',
      customer: { name: 'Cust', email: 'c@example.com' },
    });

    // At 11:00 IST (60m elapsed, 210m remaining)
    const statusAt11 = service.computeTicketSlaStatus(
      ticket,
      createIstDate(2026, 11, 23, 11, 0, 0),
      testHolidays
    );
    expect(statusAt11.isLate).toBe(false);
    expect(statusAt11.timeRemainingWorkingMinutes).toBe(210);
    expect(statusAt11.overdueWorkingMinutes).toBe(0);

    // At 15:30 IST (1 hour / 60m after deadline of 14:30 IST)
    const statusAt1530 = service.computeTicketSlaStatus(
      ticket,
      createIstDate(2026, 11, 23, 15, 30, 0),
      testHolidays
    );
    expect(statusAt1530.isLate).toBe(true);
    expect(statusAt1530.overdueWorkingMinutes).toBe(60);
    expect(statusAt1530.timeRemainingWorkingMinutes).toBe(0);
  });
});
