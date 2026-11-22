import { Router, Request, Response } from 'express';
import { pool } from '../db/connection.js';
import { DbClient, withTransaction } from '../db/transaction.js';
import { Clock, SystemClock } from '../time/clock.js';
import { TicketService } from '../domain/ticketService.js';
import { TicketPriority, TicketRow } from '../domain/types.js';
import { publicRateLimiter } from '../customer/rateLimiter.js';
import {
  serializeCustomerTicket,
  serializeCustomerMessage,
  serializeCustomerExportCsv,
} from '../customer/serializers.js';
import { workingMinutesBetween, HolidayInput } from '../time/workingTime.js';
import { computeDeadlines } from '../time/slaPolicy.js';

export function createCustomerRouter(
  db: DbClient = pool,
  clock: Clock = new SystemClock()
): Router {
  const router = Router();
  const ticketService = new TicketService(db, clock);

  // Apply rate limiter on all public customer endpoints
  router.use(publicRateLimiter);

  async function getHolidays(): Promise<HolidayInput> {
    const res = await db.query<{ holiday_date: string }>('SELECT holiday_date FROM holidays;');
    return res.rows.map((r) => r.holiday_date);
  }

  // Map urgency selections to standard TicketPriority per R10
  function mapUrgency(urgency?: string): TicketPriority {
    if (!urgency) return 'Medium';
    const normalized = urgency.trim().toLowerCase();
    if (normalized === 'i cannot work at all' || normalized === 'urgent') {
      return 'Urgent';
    }
    if (normalized === 'question or small request' || normalized === 'small') {
      return 'Small';
    }
    return 'Medium'; // default
  }

  // Helper to find ticket by secret token
  async function findTicketByToken(token: string): Promise<TicketRow | null> {
    if (!token || typeof token !== 'string') return null;
    const res = await db.query<TicketRow>(
      'SELECT * FROM tickets WHERE public_token = $1 LIMIT 1;',
      [token.trim()]
    );
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  // 1. Create ticket (public endpoint, R10)
  router.post('/tickets', async (req: Request, res: Response) => {
    const { name, email, subject, description, urgency, parentTicketId } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Name is required (at least 2 characters)' });
      return;
    }
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'A valid email address is required' });
      return;
    }
    if (!subject || typeof subject !== 'string' || subject.trim().length < 3) {
      res.status(400).json({ error: 'Subject is required (at least 3 characters)' });
      return;
    }
    if (!description || typeof description !== 'string' || description.trim().length < 5) {
      res.status(400).json({ error: 'Description is required (at least 5 characters)' });
      return;
    }

    const priority = mapUrgency(urgency);

    try {
      const ticket = await ticketService.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        priority,
        parentTicketId: parentTicketId ? String(parentTicketId).trim() : undefined,
        customer: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
        },
      });

      res.status(201).json({
        ticket: serializeCustomerTicket(ticket, false),
        token: ticket.public_token,
        publicToken: ticket.public_token,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to create ticket: ${message}` });
    }
  });

  // 2. Get ticket by secret token (public conversation only, R8 & R10)
  router.get('/tickets/:token', async (req: Request, res: Response) => {
    const token = String(req.params.token);

    try {
      const now = clock.now();
      // Lazy auto-close sweep on read (for free tier sleeping environments, R3)
      await ticketService.sweepAutoCloseTickets(now);

      const ticket = await findTicketByToken(token);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      const holidays = await getHolidays();

      // Check reopen window (5 working days = 2700 working minutes from resolved_at)
      let canReopen = false;
      if (ticket.status === 'RESOLVED' && ticket.resolved_at) {
        const workingMinutesSinceResolved = workingMinutesBetween(
          new Date(ticket.resolved_at),
          now,
          holidays
        );
        canReopen = workingMinutesSinceResolved <= 2700;
      }

      // Fetch customer-visible messages only
      const msgRes = await db.query(
        `SELECT id, sender_type, sender_name, body, created_at
         FROM messages
         WHERE ticket_id = $1
         ORDER BY created_at ASC;`,
        [ticket.id]
      );

      const messages = msgRes.rows.map(serializeCustomerMessage);

      res.status(200).json({
        ticket: serializeCustomerTicket(ticket, canReopen),
        messages,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to fetch ticket: ${message}` });
    }
  });

  // 3. Customer reply (resumes SLA if waiting on customer, R2)
  router.post('/tickets/:token/reply', async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const { body } = req.body || {};

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'Reply body is required and cannot be empty' });
      return;
    }

    try {
      const ticket = await findTicketByToken(token);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      if (ticket.status === 'CLOSED') {
        res.status(400).json({
          error: 'This ticket is closed and cannot receive replies. Please open a new ticket.',
          isClosed: true,
          canFollowUp: true,
          followUp: {
            parentTicketId: ticket.id,
            subject: `Follow-up: ${ticket.subject}`,
          },
        });
        return;
      }

      // Customer name
      const custRes = await db.query<{ name: string }>(
        'SELECT name FROM customers WHERE id = $1 LIMIT 1;',
        [ticket.customer_id]
      );
      const customerName = custRes.rows[0]?.name || 'Customer';

      const result = await ticketService.addPublicReply({
        ticketId: ticket.id,
        sender: {
          type: 'customer',
          name: customerName,
        },
        body: body.trim(),
      });

      res.status(200).json({
        success: true,
        messageId: result.messageId,
        ticket: serializeCustomerTicket(result.ticket),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to add reply: ${message}` });
    }
  });

  // 4. Reopen ticket (R4)
  router.post('/tickets/:token/reopen', async (req: Request, res: Response) => {
    const token = String(req.params.token);

    try {
      const ticket = await findTicketByToken(token);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      if (ticket.status !== 'RESOLVED') {
        res.status(400).json({
          error: `Ticket in '${ticket.status}' status cannot be reopened. Only RESOLVED tickets can be reopened.`,
        });
        return;
      }

      const now = clock.now();
      const holidays = await getHolidays();
      const resolvedAt = new Date(ticket.resolved_at!);
      const workingMinutesSinceResolved = workingMinutesBetween(resolvedAt, now, holidays);

      // 5 working days = 45 working hours = 2700 working minutes
      if (workingMinutesSinceResolved > 2700) {
        // Record reopen_rejected event
        await db.query(
          `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
           VALUES ($1, 'reopen_rejected', 'customer', 'Customer', $2, $3);`,
          [
            ticket.id,
            now,
            JSON.stringify({
              workingMinutesSinceResolved,
              maxAllowedMinutes: 2700,
              reason: 'Reopen window expired (5 working days exceeded)',
            }),
          ]
        );

        res.status(400).json({
          error: 'The reopen window of 5 working days has expired. Please open a new follow-up ticket.',
          expired: true,
          canFollowUp: true,
          followUp: {
            parentTicketId: ticket.id,
            subject: `Follow-up: ${ticket.subject}`,
          },
        });
        return;
      }

      // Perform reopen within transaction: start new SLA cycle from reopen time
      const reopenedTicket = await withTransaction(db, async (tx) => {
        const newCycle = ticket.cycle + 1;
        const newDeadlines = computeDeadlines(now, ticket.priority, holidays);

        const updateRes = await tx.query<TicketRow>(
          `UPDATE tickets
           SET status = 'OPEN',
               cycle = $2,
               clock_start = $3,
               response_due_at = $4,
               resolution_due_at = $5,
               first_response_at = NULL,
               resolved_at = NULL,
               first_response_breached = FALSE,
               resolution_breached = FALSE,
               version = version + 1,
               updated_at = $6
           WHERE id = $1
           RETURNING *;`,
          [
            ticket.id,
            newCycle,
            newDeadlines.clockStart,
            newDeadlines.responseDueAt,
            newDeadlines.resolutionDueAt,
            now,
          ]
        );

        await tx.query(
          `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
           VALUES ($1, 'reopened', 'customer', 'Customer', $2, $3);`,
          [
            ticket.id,
            now,
            JSON.stringify({
              cycle: newCycle,
              workingMinutesSinceResolved,
              newClockStart: newDeadlines.clockStart,
              newResponseDueAt: newDeadlines.responseDueAt,
              newResolutionDueAt: newDeadlines.resolutionDueAt,
            }),
          ]
        );

        await tx.query(
          `INSERT INTO ticket_events (ticket_id, event_type, actor_type, actor_name, occurred_at, payload)
           VALUES ($1, 'status_changed', 'customer', 'Customer', $2, $3);`,
          [
            ticket.id,
            now,
            JSON.stringify({ oldStatus: 'RESOLVED', newStatus: 'OPEN' }),
          ]
        );

        return updateRes.rows[0];
      });

      res.status(200).json({
        success: true,
        ticket: serializeCustomerTicket(reopenedTicket, false),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Reopen failed: ${message}` });
    }
  });

  // 5. Customer export of their own ticket (JSON / CSV, public messages only, R8)
  router.get('/tickets/:token/export', async (req: Request, res: Response) => {
    const token = String(req.params.token);
    const format = ((req.query.format as string) || 'json').toLowerCase();

    try {
      const ticket = await findTicketByToken(token);
      if (!ticket) {
        res.status(404).json({ error: 'Ticket not found' });
        return;
      }

      // Fetch public customer messages only
      const msgRes = await db.query(
        `SELECT id, sender_type, sender_name, body, created_at
         FROM messages
         WHERE ticket_id = $1
         ORDER BY created_at ASC;`,
        [ticket.id]
      );

      const serializedTicket = serializeCustomerTicket(ticket);
      const serializedMessages = msgRes.rows.map(serializeCustomerMessage);

      if (format === 'csv') {
        const csv = serializeCustomerExportCsv(serializedTicket, serializedMessages);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="ticket-${ticket.ticket_number}.csv"`);
        res.status(200).send(csv);
        return;
      }

      res.status(200).json({
        ticket: serializedTicket,
        messages: serializedMessages,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Export failed: ${message}` });
    }
  });

  return router;
}

