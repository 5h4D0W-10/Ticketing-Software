import { Router, Response } from 'express';
import { pool } from '../db/connection.js';
import { requireAuth, requireRole, AuthenticatedRequest } from '../auth/middleware.js';
import { TicketService } from '../domain/ticketService.js';
import { DbClient } from '../db/transaction.js';
import { Clock, SystemClock } from '../time/clock.js';
import { TicketPriority, TicketRow } from '../domain/types.js';
import { generateLateTicketsReport, formatWorkingDuration } from '../domain/reports.js';
import { workingMinutesBetween } from '../time/workingTime.js';

export function createAgentRouter(
  db: DbClient = pool,
  clock: Clock = new SystemClock()
): Router {
  const router = Router();
  const ticketService = new TicketService(db, clock);

  // Require authentication on all agent endpoints
  router.use(requireAuth);

  // Helper to check assignee or lead
  async function getTicketAndVerifyAssignee(
    ticketId: string,
    req: AuthenticatedRequest,
    res: Response
  ): Promise<TicketRow | null> {
    const resTicket = await db.query<TicketRow>(
      'SELECT * FROM tickets WHERE id = $1;',
      [ticketId]
    );

    if (resTicket.rows.length === 0) {
      res.status(404).json({ error: `Ticket ${ticketId} not found` });
      return null;
    }

    const ticket = resTicket.rows[0];
    const user = req.user!;

    if (user.role === 'lead') {
      return ticket;
    }

    if (ticket.assignee_id !== user.id) {
      res.status(403).json({
        error: 'Forbidden: Only the assigned agent or a lead can perform this action on this ticket',
      });
      return null;
    }

    return ticket;
  }

  // 1. List tickets (with filters, sorting, and SLA status badges)
  router.get('/tickets', async (req: AuthenticatedRequest, res: Response) => {
    const filter = (req.query.filter as string) || 'all';
    const now = clock.now();

    try {
      let query = `
        SELECT t.*,
               c.name as customer_name,
               c.email as customer_email,
               u.name as assignee_name
        FROM tickets t
        JOIN customers c ON t.customer_id = c.id
        LEFT JOIN users u ON t.assignee_id = u.id
      `;
      const params: unknown[] = [];

      if (filter === 'mine') {
        params.push(req.user!.id);
        query += ` WHERE t.assignee_id = $${params.length}`;
      } else if (filter === 'unassigned') {
        query += ` WHERE t.assignee_id IS NULL`;
      } else if (filter === 'waiting_customer') {
        query += ` WHERE t.status = 'WAITING_CUSTOMER'`;
      }

      // Sort by most urgent active deadline
      query += `
        ORDER BY
          CASE
            WHEN t.status = 'CLOSED' THEN 3
            WHEN t.status = 'RESOLVED' THEN 2
            ELSE 1
          END ASC,
          CASE
            WHEN t.first_response_at IS NULL THEN t.response_due_at
            ELSE t.resolution_due_at
          END ASC;
      `;

      const result = await db.query<TicketRow & {
        customer_name: string;
        customer_email: string;
        assignee_name: string | null;
      }>(query, params);

      // Decorate tickets with real-time SLA calculations
      let decorated = result.rows.map((row) => {
        const sla = ticketService.computeTicketSlaStatus(row, now);
        return {
          id: row.id,
          ticketNumber: row.ticket_number,
          subject: row.subject,
          priority: row.priority,
          status: row.status,
          assigneeId: row.assignee_id,
          assigneeName: row.assignee_name,
          customerName: row.customer_name,
          customerEmail: row.customer_email,
          clockStart: row.clock_start,
          responseDueAt: row.response_due_at,
          resolutionDueAt: row.resolution_due_at,
          firstResponseAt: row.first_response_at,
          resolvedAt: row.resolved_at,
          closedAt: row.closed_at,
          isLate: sla.isLate,
          lateMilestone: sla.lateMilestone,
          overdueWorkingMinutes: sla.overdueWorkingMinutes,
          timeRemainingWorkingMinutes: sla.timeRemainingWorkingMinutes,
          isWaitingCustomer: row.status === 'WAITING_CUSTOMER',
          badges: {
            isLate: sla.isLate,
            isWaitingCustomer: row.status === 'WAITING_CUSTOMER',
            isUrgent: row.priority === 'Urgent',
          },
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };
      });

      if (filter === 'late') {
        decorated = decorated.filter((t) => t.isLate);
      }

      res.status(200).json({ tickets: decorated });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to fetch tickets: ${message}` });
    }
  });

  // 2. CSV Export for agents (internal notes strictly excluded)
  router.get('/tickets/export/csv', async (req: AuthenticatedRequest, res: Response) => {
    const now = clock.now();
    try {
      const result = await db.query<TicketRow & {
        customer_name: string;
        customer_email: string;
        assignee_name: string | null;
      }>(
        `SELECT t.*,
                c.name as customer_name,
                c.email as customer_email,
                u.name as assignee_name
         FROM tickets t
         JOIN customers c ON t.customer_id = c.id
         LEFT JOIN users u ON t.assignee_id = u.id
         ORDER BY t.created_at DESC;`
      );

      const headers = [
        'id',
        'ticket_number',
        'subject',
        'priority',
        'status',
        'customer_name',
        'customer_email',
        'assignee_name',
        'clock_start',
        'response_due_at',
        'resolution_due_at',
        'first_response_at',
        'resolved_at',
        'is_late',
        'created_at',
      ];

      const rows = result.rows.map((row) => {
        const sla = ticketService.computeTicketSlaStatus(row, now);
        return [
          row.id,
          row.ticket_number,
          `"${(row.subject || '').replace(/"/g, '""')}"`,
          row.priority,
          row.status,
          `"${(row.customer_name || '').replace(/"/g, '""')}"`,
          row.customer_email,
          `"${(row.assignee_name || 'Unassigned').replace(/"/g, '""')}"`,
          new Date(row.clock_start).toISOString(),
          new Date(row.response_due_at).toISOString(),
          new Date(row.resolution_due_at).toISOString(),
          row.first_response_at ? new Date(row.first_response_at).toISOString() : '',
          row.resolved_at ? new Date(row.resolved_at).toISOString() : '',
          sla.isLate ? 'YES' : 'NO',
          new Date(row.created_at).toISOString(),
        ].join(',');
      });

      const csvContent = [headers.join(','), ...rows].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="tickets-export.csv"');
      res.status(200).send(csvContent);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `CSV export failed: ${message}` });
    }
  });

  // 3. Late tickets report (Lead only, R6)
  router.get(
    '/reports/late',
    requireRole('lead'),
    async (_req: AuthenticatedRequest, res: Response) => {
      const now = clock.now();
      try {
        const report = await generateLateTicketsReport(db, ticketService, now);
        res.status(200).json({ report });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: `Failed to generate late report: ${message}` });
      }
    }
  );

  // 4. Ticket Detail with full timeline (messages, internal notes, events)
  router.get('/tickets/:id', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const now = clock.now();

    try {
      const ticketRes = await db.query<TicketRow & {
        customer_name: string;
        customer_email: string;
        assignee_name: string | null;
      }>(
        `SELECT t.*,
                c.name as customer_name,
                c.email as customer_email,
                u.name as assignee_name
         FROM tickets t
         JOIN customers c ON t.customer_id = c.id
         LEFT JOIN users u ON t.assignee_id = u.id
         WHERE t.id = $1;`,
        [ticketId]
      );

      if (ticketRes.rows.length === 0) {
        res.status(404).json({ error: `Ticket ${ticketId} not found` });
        return;
      }

      const ticket = ticketRes.rows[0];
      const sla = ticketService.computeTicketSlaStatus(ticket, now);

      // Fetch customer-visible messages
      const messagesRes = await db.query(
        `SELECT id, sender_type, sender_id, sender_name, body, created_at
         FROM messages
         WHERE ticket_id = $1
         ORDER BY created_at ASC;`,
        [ticketId]
      );

      // Fetch team-only internal notes (authorized for agent route!)
      const notesRes = await db.query(
        `SELECT id, author_id, author_name, body, created_at
         FROM internal_notes
         WHERE ticket_id = $1
         ORDER BY created_at ASC;`,
        [ticketId]
      );

      // Fetch audit events
      const eventsRes = await db.query(
        `SELECT id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         FROM ticket_events
         WHERE ticket_id = $1
         ORDER BY occurred_at ASC;`,
        [ticketId]
      );

      // First response explanation string (R9)
      let firstResponseSummary: string | null = null;
      if (ticket.first_response_at) {
        const firstReplyEvent = eventsRes.rows.find(
          (e) => e.event_type === 'public_reply' && e.actor_type === 'agent'
        );
        const responderName = firstReplyEvent?.actor_name || 'Agent';
        const workingMinutes = workingMinutesBetween(
          new Date(ticket.clock_start),
          new Date(ticket.first_response_at)
        );
        firstResponseSummary = `first replied at ${new Date(
          ticket.first_response_at
        ).toISOString()} by ${responderName} (${formatWorkingDuration(workingMinutes)} after creation)`;
      }

      // Merge into a comprehensive timeline sorted chronologically
      const timeline: Array<{
        type: 'message' | 'internal_note' | 'event';
        timestamp: string;
        data: Record<string, unknown>;
      }> = [];

      for (const m of messagesRes.rows) {
        timeline.push({
          type: 'message',
          timestamp: new Date(m.created_at).toISOString(),
          data: m,
        });
      }

      for (const n of notesRes.rows) {
        timeline.push({
          type: 'internal_note',
          timestamp: new Date(n.created_at).toISOString(),
          data: n,
        });
      }

      for (const e of eventsRes.rows) {
        timeline.push({
          type: 'event',
          timestamp: new Date(e.occurred_at).toISOString(),
          data: e,
        });
      }

      timeline.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      res.status(200).json({
        ticket: {
          id: ticket.id,
          ticketNumber: ticket.ticket_number,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority,
          status: ticket.status,
          assigneeId: ticket.assignee_id,
          assigneeName: ticket.assignee_name,
          customerName: ticket.customer_name,
          customerEmail: ticket.customer_email,
          clockStart: ticket.clock_start,
          responseDueAt: ticket.response_due_at,
          resolutionDueAt: ticket.resolution_due_at,
          firstResponseAt: ticket.first_response_at,
          firstResponseSummary,
          resolvedAt: ticket.resolved_at,
          closedAt: ticket.closed_at,
          isLate: sla.isLate,
          lateMilestone: sla.lateMilestone,
          overdueWorkingMinutes: sla.overdueWorkingMinutes,
          timeRemainingWorkingMinutes: sla.timeRemainingWorkingMinutes,
          isWaitingCustomer: ticket.status === 'WAITING_CUSTOMER',
          createdAt: ticket.created_at,
          updatedAt: ticket.updated_at,
        },
        timeline,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `Failed to fetch ticket detail: ${message}` });
    }
  });

  // 5. Atomic Claim (INC-0291, R7)
  router.post('/tickets/:id/claim', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const user = req.user!;

    try {
      const ticket = await ticketService.claimTicket(ticketId, {
        id: user.id,
        name: user.name,
      });
      res.status(200).json({ ticket });
    } catch (err: any) {
      if (err.name === 'ConcurrencyError') {
        res.status(409).json({ error: err.message });
      } else {
        res.status(500).json({ error: err.message || 'Claim failed' });
      }
    }
  });

  // 6. Release ticket
  router.post('/tickets/:id/release', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const verified = await getTicketAndVerifyAssignee(ticketId, req, res);
    if (!verified) return;

    try {
      const ticket = await ticketService.releaseTicket(ticketId, {
        type: 'agent',
        id: req.user!.id,
        name: req.user!.name,
      });
      res.status(200).json({ ticket });
    } catch (err: any) {
      res.status(422).json({ error: err.message || 'Release failed' });
    }
  });

  // 7. Public Reply (with optional waitForCustomer)
  router.post('/tickets/:id/reply', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const { body, waitForCustomer } = req.body || {};

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'Reply body is required and cannot be empty' });
      return;
    }

    const verified = await getTicketAndVerifyAssignee(ticketId, req, res);
    if (!verified) return;

    try {
      const result = await ticketService.addPublicReply({
        ticketId,
        sender: {
          type: 'agent',
          id: req.user!.id,
          name: req.user!.name,
        },
        body: body.trim(),
        sendAndWait: Boolean(waitForCustomer),
      });

      res.status(200).json({
        ticket: result.ticket,
        messageId: result.messageId,
      });
    } catch (err: any) {
      res.status(422).json({ error: err.message || 'Reply failed' });
    }
  });

  // 8. Internal Note (INC-0304, R8)
  router.post('/tickets/:id/notes', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const { body } = req.body || {};

    if (!body || typeof body !== 'string' || body.trim().length === 0) {
      res.status(400).json({ error: 'Internal note body is required and cannot be empty' });
      return;
    }

    const verified = await getTicketAndVerifyAssignee(ticketId, req, res);
    if (!verified) return;

    try {
      const result = await ticketService.addInternalNote({
        ticketId,
        author: {
          id: req.user!.id,
          name: req.user!.name,
        },
        body: body.trim(),
      });

      res.status(200).json({ noteId: result.noteId });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Note creation failed' });
    }
  });

  // 9. Resolve Ticket
  router.post('/tickets/:id/resolve', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const verified = await getTicketAndVerifyAssignee(ticketId, req, res);
    if (!verified) return;

    try {
      const ticket = await ticketService.resolveTicket(ticketId, {
        type: 'agent',
        id: req.user!.id,
        name: req.user!.name,
      });
      res.status(200).json({ ticket });
    } catch (err: any) {
      res.status(422).json({ error: err.message || 'Resolve failed' });
    }
  });

  // 10. Change Priority (R5)
  router.post('/tickets/:id/priority', async (req: AuthenticatedRequest, res: Response) => {
    const ticketId = req.params.id;
    const { priority } = req.body || {};

    if (!priority || !['Urgent', 'Medium', 'Small'].includes(priority)) {
      res.status(400).json({
        error: "Priority is required and must be one of: 'Urgent', 'Medium', 'Small'",
      });
      return;
    }

    const verified = await getTicketAndVerifyAssignee(ticketId, req, res);
    if (!verified) return;

    try {
      const ticket = await ticketService.changePriority(
        ticketId,
        priority as TicketPriority,
        {
          type: 'agent',
          id: req.user!.id,
          name: req.user!.name,
        }
      );
      res.status(200).json({ ticket });
    } catch (err: any) {
      res.status(422).json({ error: err.message || 'Priority change failed' });
    }
  });

  // 11. Holidays CRUD
  router.get('/holidays', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const holidayRes = await db.query(
        'SELECT id, holiday_date, name, description, created_at FROM holidays ORDER BY holiday_date ASC;'
      );
      res.status(200).json({ holidays: holidayRes.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/holidays', requireRole('lead'), async (req: AuthenticatedRequest, res: Response) => {
    const { holiday_date, name, description } = req.body || {};

    if (!holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(holiday_date)) {
      res.status(400).json({ error: 'Valid holiday_date (YYYY-MM-DD) is required' });
      return;
    }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Holiday name is required' });
      return;
    }

    try {
      const insertRes = await db.query(
        `INSERT INTO holidays (holiday_date, name, description)
         VALUES ($1, $2, $3)
         RETURNING *;`,
        [holiday_date, name.trim(), description || null]
      );
      res.status(201).json({ holiday: insertRes.rows[0] });
    } catch (err: any) {
      res.status(400).json({ error: `Failed to add holiday: ${err.message}` });
    }
  });

  router.delete('/holidays/:id', requireRole('lead'), async (req: AuthenticatedRequest, res: Response) => {
    const holidayId = req.params.id;
    try {
      const delRes = await db.query('DELETE FROM holidays WHERE id = $1 RETURNING id;', [holidayId]);
      if (delRes.rows.length === 0) {
        res.status(404).json({ error: `Holiday ${holidayId} not found` });
        return;
      }
      res.status(200).json({ success: true, deletedId: holidayId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

