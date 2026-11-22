import crypto from 'crypto';
import { DbClient, withTransaction } from '../db/transaction.js';
import { Clock, SystemClock } from '../time/clock.js';
import {
  HolidayInput,
  workingMinutesBetween,
  addWorkingMinutes,
} from '../time/workingTime.js';
import {
  computeDeadlines,
  recomputeDeadlinesOnPriorityChange,
} from '../time/slaPolicy.js';
import { assertValidTransition } from './stateMachine.js';
import {
  TicketRow,
  TicketPriority,
  TicketStatus,
  Actor,
  ConcurrencyError,
} from './types.js';

export interface CreateTicketInput {
  subject: string;
  description: string;
  priority: TicketPriority;
  customer: {
    name: string;
    email: string;
  };
  actor?: Actor;
  parentTicketId?: string;
}

export interface TicketSlaStatus {
  isLate: boolean;
  lateMilestone?: 'first_response' | 'resolution';
  overdueWorkingMinutes: number;
  timeRemainingWorkingMinutes: number;
  isPaused: boolean;
  activeMilestone: 'first_response' | 'resolution' | 'completed';
  activeDeadline: Date | null;
}

export class TicketService {
  constructor(
    private readonly db: DbClient,
    private readonly clock: Clock = new SystemClock(),
    private readonly getHolidaysFn?: () => Promise<HolidayInput>
  ) {}

  private async getHolidays(): Promise<HolidayInput> {
    if (this.getHolidaysFn) {
      return this.getHolidaysFn();
    }
    const res = await this.db.query<{ holiday_date: string }>(
      'SELECT holiday_date FROM holidays;'
    );
    return res.rows.map((r) => r.holiday_date);
  }

  /**
   * Creates a new ticket inside a single database transaction.
   * Computes clock start and SLA deadlines via the working-time engine.
   * Records ticket_created event and initial customer message.
   */
  async createTicket(input: CreateTicketInput): Promise<TicketRow> {
    const now = this.clock.now();
    const holidays = await this.getHolidays();
    const deadlines = computeDeadlines(now, input.priority, holidays);
    const publicToken = crypto.randomBytes(24).toString('hex');

    return withTransaction(this.db, async (tx) => {
      // 1. Find or create customer
      const existingCustomer = await tx.query<{ id: string }>(
        'SELECT id FROM customers WHERE email = $1 LIMIT 1;',
        [input.customer.email.toLowerCase()]
      );

      let customerId: string;
      if (existingCustomer.rows.length > 0) {
        customerId = existingCustomer.rows[0].id;
      } else {
        const newCustomer = await tx.query<{ id: string }>(
          `INSERT INTO customers (name, email, created_at)
           VALUES ($1, $2, $3)
           RETURNING id;`,
          [input.customer.name, input.customer.email.toLowerCase(), now]
        );
        customerId = newCustomer.rows[0].id;
      }

      // 2. Insert ticket
      const insertTicketRes = await tx.query<TicketRow>(
        `INSERT INTO tickets (
           subject, description, priority, status, customer_id, version,
           clock_start, response_due_at, resolution_due_at, cycle,
           parent_ticket_id, public_token, created_at, updated_at
         )
         VALUES ($1, $2, $3, 'NEW', $4, 1, $5, $6, $7, 1, $8, $9, $10, $10)
         RETURNING *;`,
        [
          input.subject,
          input.description,
          input.priority,
          customerId,
          deadlines.clockStart,
          deadlines.responseDueAt,
          deadlines.resolutionDueAt,
          input.parentTicketId || null,
          publicToken,
          now,
        ]
      );

      const ticket = insertTicketRes.rows[0];

      // 3. Insert customer message
      await tx.query(
        `INSERT INTO messages (
           ticket_id, sender_type, sender_id, sender_name, body, created_at
         )
         VALUES ($1, 'customer', $2, $3, $4, $5);`,
        [ticket.id, customerId, input.customer.name, input.description, now]
      );

      // 4. Record ticket_created event
      const actor = input.actor || {
        type: 'customer',
        id: customerId,
        name: input.customer.name,
      };

      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'ticket_created', $2, $3, $4, $5, $6);`,
        [
          ticket.id,
          actor.type,
          actor.id || null,
          actor.name,
          now,
          JSON.stringify({
            priority: ticket.priority,
            clockStart: deadlines.clockStart,
            responseDueAt: deadlines.responseDueAt,
            resolutionDueAt: deadlines.resolutionDueAt,
            subject: ticket.subject,
          }),
        ]
      );

      return ticket;
    });
  }

  /**
   * Atomic ticket claim (INC-0291, R7).
   * Conditional UPDATE ... WHERE assignee_id IS NULL prevents double-taking.
   * Loser gets ConcurrencyError with HTTP 409 status code.
   */
  async claimTicket(
    ticketId: string,
    agent: { id: string; name: string }
  ): Promise<TicketRow> {
    const now = this.clock.now();

    return withTransaction(this.db, async (tx) => {
      // Conditional atomic update
      const updateRes = await tx.query<TicketRow>(
        `UPDATE tickets
         SET assignee_id = $1, status = 'OPEN', version = version + 1, updated_at = $2
         WHERE id = $3 AND assignee_id IS NULL
         RETURNING *;`,
        [agent.id, now, ticketId]
      );

      if (updateRes.rows.length === 0) {
        // Inspect current ticket state to return helpful error
        const currentRes = await tx.query<TicketRow & { assignee_name?: string }>(
          `SELECT t.*, u.name as assignee_name
           FROM tickets t
           LEFT JOIN users u ON t.assignee_id = u.id
           WHERE t.id = $1;`,
          [ticketId]
        );

        if (currentRes.rows.length === 0) {
          throw new Error(`Ticket ${ticketId} not found`);
        }

        const current = currentRes.rows[0];
        if (current.assignee_id) {
          throw new ConcurrencyError(
            `Ticket is already claimed by ${current.assignee_name || current.assignee_id}`
          );
        }

        throw new ConcurrencyError('Ticket claim failed due to concurrent modification');
      }

      const updatedTicket = updateRes.rows[0];

      // Record 'claimed' audit event
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'claimed', 'agent', $2, $3, $4, $5);`,
        [
          ticketId,
          agent.id,
          agent.name,
          now,
          JSON.stringify({
            assigneeId: agent.id,
            assigneeName: agent.name,
          }),
        ]
      );

      // Record 'status_changed' audit event
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'status_changed', 'agent', $2, $3, $4, $5);`,
        [
          ticketId,
          agent.id,
          agent.name,
          now,
          JSON.stringify({
            oldStatus: 'NEW',
            newStatus: 'OPEN',
          }),
        ]
      );

      return updatedTicket;
    });
  }

  /**
   * Release an assigned ticket back to the unassigned queue.
   */
  async releaseTicket(
    ticketId: string,
    actor: Actor
  ): Promise<TicketRow> {
    const now = this.clock.now();

    return withTransaction(this.db, async (tx) => {
      const ticketRes = await tx.query<TicketRow>(
        'SELECT * FROM tickets WHERE id = $1 FOR UPDATE;',
        [ticketId]
      );
      if (ticketRes.rows.length === 0) {
        throw new Error(`Ticket ${ticketId} not found`);
      }
      const ticket = ticketRes.rows[0];
      assertValidTransition(ticket.status, 'NEW');

      const updateRes = await tx.query<TicketRow>(
        `UPDATE tickets
         SET assignee_id = NULL, status = 'NEW', version = version + 1, updated_at = $2
         WHERE id = $1
         RETURNING *;`,
        [ticketId, now]
      );

      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'released', $2, $3, $4, $5, $6);`,
        [
          ticketId,
          actor.type,
          actor.id || null,
          actor.name,
          now,
          JSON.stringify({ previousAssigneeId: ticket.assignee_id }),
        ]
      );

      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'status_changed', $2, $3, $4, $5, $6);`,
        [
          ticketId,
          actor.type,
          actor.id || null,
          actor.name,
          now,
          JSON.stringify({ oldStatus: ticket.status, newStatus: 'NEW' }),
        ]
      );

      return updateRes.rows[0];
    });
  }

  /**
   * Adds a public reply to the ticket conversation.
   * Handles first response tracking, breach detection, and SLA pause/resume.
   */
  async addPublicReply(params: {
    ticketId: string;
    sender: Actor;
    body: string;
    sendAndWait?: boolean;
  }): Promise<{ ticket: TicketRow; messageId: string }> {
    const now = this.clock.now();
    const holidays = await this.getHolidays();

    return withTransaction(this.db, async (tx) => {
      const ticketRes = await tx.query<TicketRow>(
        'SELECT * FROM tickets WHERE id = $1 FOR UPDATE;',
        [params.ticketId]
      );
      if (ticketRes.rows.length === 0) {
        throw new Error(`Ticket ${params.ticketId} not found`);
      }
      let ticket = ticketRes.rows[0];

      // Insert message into messages table (customer-visible only)
      const msgRes = await tx.query<{ id: string }>(
        `INSERT INTO messages (
           ticket_id, sender_type, sender_id, sender_name, body, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id;`,
        [
          params.ticketId,
          params.sender.type,
          params.sender.id || null,
          params.sender.name,
          params.body,
          now,
        ]
      );
      const messageId = msgRes.rows[0].id;

      // Write 'public_reply' event
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'public_reply', $2, $3, $4, $5, $6);`,
        [
          params.ticketId,
          params.sender.type,
          params.sender.id || null,
          params.sender.name,
          now,
          JSON.stringify({ messageId, sendAndWait: Boolean(params.sendAndWait) }),
        ]
      );

      // --- Case A: AGENT REPLY ---
      if (params.sender.type === 'agent') {
        // Track first response if not yet recorded
        if (ticket.first_response_at === null) {
          // Total paused time prior to this reply
          const totalPausedWorkingMinutes = await this.getTotalPausedWorkingMinutes(
            tx,
            ticket.id,
            ticket.cycle,
            now,
            holidays
          );

          const totalElapsedWorkingMinutes = workingMinutesBetween(
            new Date(ticket.clock_start),
            now,
            holidays
          );
          const firstResponseWorkingMinutes = Math.max(
            0,
            totalElapsedWorkingMinutes - totalPausedWorkingMinutes
          );

          const isLate = now.getTime() > new Date(ticket.response_due_at).getTime();

          const updateTicketRes = await tx.query<TicketRow>(
            `UPDATE tickets
             SET first_response_at = $2,
                 first_response_breached = first_response_breached OR $3,
                 version = version + 1,
                 updated_at = $2
             WHERE id = $1
             RETURNING *;`,
            [ticket.id, now, isLate]
          );
          ticket = updateTicketRes.rows[0];

          if (isLate) {
            await this.recordBreachEvent(tx, ticket.id, 'first_response', ticket.response_due_at, now, {
              workingMinutesElapsed: firstResponseWorkingMinutes,
              deadline: ticket.response_due_at,
            });
          }
        }

        // If agent specified "Send & wait for customer", PAUSE SLA (R2)
        if (params.sendAndWait && ticket.status !== 'WAITING_CUSTOMER') {
          assertValidTransition(ticket.status, 'WAITING_CUSTOMER');

          // Record open pause row
          await tx.query(
            `INSERT INTO sla_pauses (ticket_id, cycle, paused_at, created_at)
             VALUES ($1, $2, $3, $3);`,
            [ticket.id, ticket.cycle, now]
          );

          // Update ticket status to WAITING_CUSTOMER
          const pauseRes = await tx.query<TicketRow>(
            `UPDATE tickets
             SET status = 'WAITING_CUSTOMER', version = version + 1, updated_at = $2
             WHERE id = $1
             RETURNING *;`,
            [ticket.id, now]
          );
          ticket = pauseRes.rows[0];

          // Record sla_paused event
          await tx.query(
            `INSERT INTO ticket_events (
               ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
             )
             VALUES ($1, 'sla_paused', 'agent', $2, $3, $4, $5);`,
            [
              ticket.id,
              params.sender.id || null,
              params.sender.name,
              now,
              JSON.stringify({
                pausedAt: now,
                responseDueAt: ticket.response_due_at,
                resolutionDueAt: ticket.resolution_due_at,
              }),
            ]
          );

          // Record status_changed event
          await tx.query(
            `INSERT INTO ticket_events (
               ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
             )
             VALUES ($1, 'status_changed', 'agent', $2, $3, $4, $5);`,
            [
              ticket.id,
              params.sender.id || null,
              params.sender.name,
              now,
              JSON.stringify({ oldStatus: 'OPEN', newStatus: 'WAITING_CUSTOMER' }),
            ]
          );
        }
      }

      // --- Case B: CUSTOMER REPLY ---
      if (params.sender.type === 'customer') {
        // If ticket was waiting on customer, RESUME SLA (R2)
        if (ticket.status === 'WAITING_CUSTOMER') {
          assertValidTransition(ticket.status, 'OPEN');

          // Find open pause interval
          const openPauseRes = await tx.query<{ id: string; paused_at: Date }>(
            `SELECT id, paused_at
             FROM sla_pauses
             WHERE ticket_id = $1 AND cycle = $2 AND resumed_at IS NULL
             ORDER BY paused_at DESC
             LIMIT 1;`,
            [ticket.id, ticket.cycle]
          );

          let pausedWorkingMinutes = 0;
          if (openPauseRes.rows.length > 0) {
            const pauseRow = openPauseRes.rows[0];
            pausedWorkingMinutes = workingMinutesBetween(new Date(pauseRow.paused_at), now, holidays);

            await tx.query(
              `UPDATE sla_pauses
               SET resumed_at = $2, working_minutes_paused = $3
               WHERE id = $1;`,
              [pauseRow.id, now, pausedWorkingMinutes]
            );
          }

          // Move unmet deadlines forward by the working minutes spent paused
          let newResponseDueAt = new Date(ticket.response_due_at);
          let newResolutionDueAt = new Date(ticket.resolution_due_at);

          if (ticket.first_response_at === null) {
            newResponseDueAt = addWorkingMinutes(newResponseDueAt, pausedWorkingMinutes, holidays);
          }
          if (ticket.resolved_at === null) {
            newResolutionDueAt = addWorkingMinutes(newResolutionDueAt, pausedWorkingMinutes, holidays);
          }

          const resumeTicketRes = await tx.query<TicketRow>(
            `UPDATE tickets
             SET status = 'OPEN',
                 response_due_at = $2,
                 resolution_due_at = $3,
                 version = version + 1,
                 updated_at = $4
             WHERE id = $1
             RETURNING *;`,
            [ticket.id, newResponseDueAt, newResolutionDueAt, now]
          );
          ticket = resumeTicketRes.rows[0];

          // Record sla_resumed event
          await tx.query(
            `INSERT INTO ticket_events (
               ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
             )
             VALUES ($1, 'sla_resumed', 'customer', $2, $3, $4, $5);`,
            [
              ticket.id,
              params.sender.id || null,
              params.sender.name,
              now,
              JSON.stringify({
                resumedAt: now,
                workingMinutesPaused: pausedWorkingMinutes,
                responseDueAt: newResponseDueAt,
                resolutionDueAt: newResolutionDueAt,
              }),
            ]
          );

          // Record status_changed event
          await tx.query(
            `INSERT INTO ticket_events (
               ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
             )
             VALUES ($1, 'status_changed', 'customer', $2, $3, $4, $5);`,
            [
              ticket.id,
              params.sender.id || null,
              params.sender.name,
              now,
              JSON.stringify({ oldStatus: 'WAITING_CUSTOMER', newStatus: 'OPEN' }),
            ]
          );
        }
      }

      return { ticket, messageId };
    });
  }

  /**
   * Priority change mid-ticket (R5):
   * Recomputes both deadlines from original clock start using new priority targets,
   * preserving elapsed working time and paused working time.
   * Sticky breaches already recorded stay recorded.
   * Writes priority_changed event with old/new priority and old/new deadlines.
   */
  async changePriority(
    ticketId: string,
    newPriority: TicketPriority,
    actor: Actor
  ): Promise<TicketRow> {
    const now = this.clock.now();
    const holidays = await this.getHolidays();

    return withTransaction(this.db, async (tx) => {
      const ticketRes = await tx.query<TicketRow>(
        'SELECT * FROM tickets WHERE id = $1 FOR UPDATE;',
        [ticketId]
      );
      if (ticketRes.rows.length === 0) {
        throw new Error(`Ticket ${ticketId} not found`);
      }
      const ticket = ticketRes.rows[0];

      if (ticket.priority === newPriority) {
        return ticket; // No change needed
      }

      // Calculate total paused working minutes across completed and active pauses
      const totalPausedWorkingMinutes = await this.getTotalPausedWorkingMinutes(
        tx,
        ticket.id,
        ticket.cycle,
        now,
        holidays
      );

      // Recompute deadlines from original clock start
      const recomputed = recomputeDeadlinesOnPriorityChange(
        new Date(ticket.clock_start),
        newPriority,
        totalPausedWorkingMinutes,
        holidays
      );

      const oldPriority = ticket.priority;
      const oldResponseDueAt = ticket.response_due_at;
      const oldResolutionDueAt = ticket.resolution_due_at;

      const updateRes = await tx.query<TicketRow>(
        `UPDATE tickets
         SET priority = $2,
             response_due_at = $3,
             resolution_due_at = $4,
             version = version + 1,
             updated_at = $5
         WHERE id = $1
         RETURNING *;`,
        [ticket.id, newPriority, recomputed.responseDueAt, recomputed.resolutionDueAt, now]
      );
      const updatedTicket = updateRes.rows[0];

      // Record priority_changed event
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'priority_changed', $2, $3, $4, $5, $6);`,
        [
          ticketId,
          actor.type,
          actor.id || null,
          actor.name,
          now,
          JSON.stringify({
            oldPriority,
            newPriority,
            oldResponseDueAt,
            newResponseDueAt: recomputed.responseDueAt,
            oldResolutionDueAt,
            newResolutionDueAt: recomputed.resolutionDueAt,
            totalPausedWorkingMinutes,
          }),
        ]
      );

      // Detect any immediate breaches resulting from priority upgrade
      await this.checkAndRecordBreachesInTx(tx, updatedTicket, now);

      return updatedTicket;
    });
  }

  /**
   * Resolves a ticket and closes any active pause intervals.
   */
  async resolveTicket(ticketId: string, actor: Actor): Promise<TicketRow> {
    const now = this.clock.now();
    const holidays = await this.getHolidays();

    return withTransaction(this.db, async (tx) => {
      const ticketRes = await tx.query<TicketRow>(
        'SELECT * FROM tickets WHERE id = $1 FOR UPDATE;',
        [ticketId]
      );
      if (ticketRes.rows.length === 0) {
        throw new Error(`Ticket ${ticketId} not found`);
      }
      const ticket = ticketRes.rows[0];
      assertValidTransition(ticket.status, 'RESOLVED');

      // If resolving while paused, close open pause interval
      if (ticket.status === 'WAITING_CUSTOMER') {
        const openPauseRes = await tx.query<{ id: string; paused_at: Date }>(
          `SELECT id, paused_at
           FROM sla_pauses
           WHERE ticket_id = $1 AND cycle = $2 AND resumed_at IS NULL
           ORDER BY paused_at DESC LIMIT 1;`,
          [ticket.id, ticket.cycle]
        );
        if (openPauseRes.rows.length > 0) {
          const pause = openPauseRes.rows[0];
          const pausedWorkingMinutes = workingMinutesBetween(new Date(pause.paused_at), now, holidays);
          await tx.query(
            `UPDATE sla_pauses
             SET resumed_at = $2, working_minutes_paused = $3
             WHERE id = $1;`,
            [pause.id, now, pausedWorkingMinutes]
          );
        }
      }

      // Check resolution deadline breach
      const isResolutionLate = now.getTime() > new Date(ticket.resolution_due_at).getTime();

      const updateRes = await tx.query<TicketRow>(
        `UPDATE tickets
         SET status = 'RESOLVED',
             resolved_at = $2,
             resolution_breached = resolution_breached OR $3,
             version = version + 1,
             updated_at = $2
         WHERE id = $1
         RETURNING *;`,
        [ticket.id, now, isResolutionLate]
      );
      const updatedTicket = updateRes.rows[0];

      if (isResolutionLate) {
        await this.recordBreachEvent(tx, ticket.id, 'resolution', ticket.resolution_due_at, now, {
          resolvedAt: now,
          deadline: ticket.resolution_due_at,
        });
      }

      // Record status_changed event
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'status_changed', $2, $3, $4, $5, $6);`,
        [
          ticketId,
          actor.type,
          actor.id || null,
          actor.name,
          now,
          JSON.stringify({ oldStatus: ticket.status, newStatus: 'RESOLVED' }),
        ]
      );

      return updatedTicket;
    });
  }

  /**
   * Internal note addition (INC-0304, R8).
   * Stored in separate internal_notes table. Never visible to customers.
   */
  async addInternalNote(params: {
    ticketId: string;
    author: { id: string; name: string };
    body: string;
  }): Promise<{ noteId: string }> {
    const now = this.clock.now();

    return withTransaction(this.db, async (tx) => {
      const noteRes = await tx.query<{ id: string }>(
        `INSERT INTO internal_notes (ticket_id, author_id, author_name, body, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id;`,
        [params.ticketId, params.author.id, params.author.name, params.body, now]
      );
      const noteId = noteRes.rows[0].id;

      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'internal_note_added', 'agent', $2, $3, $4, $5);`,
        [
          params.ticketId,
          params.author.id,
          params.author.name,
          now,
          JSON.stringify({ noteId }),
        ]
      );

      return { noteId };
    });
  }

  /**
   * Evaluates active SLA deadlines and records sticky sla_breached events idempotently.
   */
  async checkAndRecordBreaches(ticketId: string): Promise<TicketRow> {
    const now = this.clock.now();

    return withTransaction(this.db, async (tx) => {
      const ticketRes = await tx.query<TicketRow>(
        'SELECT * FROM tickets WHERE id = $1 FOR UPDATE;',
        [ticketId]
      );
      if (ticketRes.rows.length === 0) {
        throw new Error(`Ticket ${ticketId} not found`);
      }
      const ticket = ticketRes.rows[0];
      return this.checkAndRecordBreachesInTx(tx, ticket, now);
    });
  }

  private async checkAndRecordBreachesInTx(
    tx: DbClient,
    ticket: TicketRow,
    now: Date
  ): Promise<TicketRow> {
    let firstResponseBreached = ticket.first_response_breached;
    let resolutionBreached = ticket.resolution_breached;

    // First response breach
    if (
      !firstResponseBreached &&
      ticket.first_response_at === null &&
      now.getTime() > new Date(ticket.response_due_at).getTime()
    ) {
      firstResponseBreached = true;
      await this.recordBreachEvent(tx, ticket.id, 'first_response', ticket.response_due_at, now, {
        deadline: ticket.response_due_at,
        detectedAt: now,
      });
    }

    // Resolution breach
    if (
      !resolutionBreached &&
      ticket.resolved_at === null &&
      now.getTime() > new Date(ticket.resolution_due_at).getTime()
    ) {
      resolutionBreached = true;
      await this.recordBreachEvent(tx, ticket.id, 'resolution', ticket.resolution_due_at, now, {
        deadline: ticket.resolution_due_at,
        detectedAt: now,
      });
    }

    if (
      firstResponseBreached !== ticket.first_response_breached ||
      resolutionBreached !== ticket.resolution_breached
    ) {
      const updateRes = await tx.query<TicketRow>(
        `UPDATE tickets
         SET first_response_breached = $2,
             resolution_breached = $3,
             updated_at = $4
         WHERE id = $1
         RETURNING *;`,
        [ticket.id, firstResponseBreached, resolutionBreached, now]
      );
      return updateRes.rows[0];
    }

    return ticket;
  }

  private async recordBreachEvent(
    tx: DbClient,
    ticketId: string,
    milestone: 'first_response' | 'resolution',
    deadline: Date,
    occurredAt: Date,
    extraPayload: Record<string, unknown> = {}
  ): Promise<void> {
    // Check if sla_breached for this milestone has already been written (idempotency)
    const existing = await tx.query(
      `SELECT id FROM ticket_events
       WHERE ticket_id = $1
         AND event_type = 'sla_breached'
         AND payload->>'milestone' = $2
       LIMIT 1;`,
      [ticketId, milestone]
    );

    if (existing.rows.length === 0) {
      await tx.query(
        `INSERT INTO ticket_events (
           ticket_id, event_type, actor_type, actor_id, actor_name, occurred_at, payload
         )
         VALUES ($1, 'sla_breached', 'system', NULL, 'system', $2, $3);`,
        [
          ticketId,
          occurredAt,
          JSON.stringify({
            milestone,
            deadline,
            ...extraPayload,
          }),
        ]
      );
    }
  }

  /**
   * Calculates total paused working minutes for a ticket in a given cycle.
   */
  async getTotalPausedWorkingMinutes(
    tx: DbClient,
    ticketId: string,
    cycle: number,
    now: Date,
    holidays?: HolidayInput
  ): Promise<number> {
    const pauseRowsRes = await tx.query<{
      paused_at: Date;
      resumed_at: Date | null;
      working_minutes_paused: number | null;
    }>(
      `SELECT paused_at, resumed_at, working_minutes_paused
       FROM sla_pauses
       WHERE ticket_id = $1 AND cycle = $2;`,
      [ticketId, cycle]
    );

    let total = 0;
    for (const row of pauseRowsRes.rows) {
      if (row.resumed_at !== null) {
        total += Number(row.working_minutes_paused || 0);
      } else {
        // Active pause: calculate up to 'now'
        total += workingMinutesBetween(new Date(row.paused_at), now, holidays);
      }
    }
    return total;
  }

  /**
   * Computes the real-time SLA status of a ticket at a given point in time.
   * Useful for list views, badge indicators, and lead reports.
   */
  computeTicketSlaStatus(
    ticket: TicketRow,
    now: Date = this.clock.now(),
    holidays?: HolidayInput
  ): TicketSlaStatus {
    const isPaused = ticket.status === 'WAITING_CUSTOMER';

    let activeMilestone: 'first_response' | 'resolution' | 'completed';
    let activeDeadline: Date | null = null;

    if (ticket.first_response_at === null) {
      activeMilestone = 'first_response';
      activeDeadline = new Date(ticket.response_due_at);
    } else if (ticket.resolved_at === null) {
      activeMilestone = 'resolution';
      activeDeadline = new Date(ticket.resolution_due_at);
    } else {
      activeMilestone = 'completed';
    }

    if (activeMilestone === 'completed') {
      const wasLate = ticket.first_response_breached || ticket.resolution_breached;
      return {
        isLate: wasLate,
        lateMilestone: ticket.resolution_breached
          ? 'resolution'
          : ticket.first_response_breached
          ? 'first_response'
          : undefined,
        overdueWorkingMinutes: 0,
        timeRemainingWorkingMinutes: 0,
        isPaused: false,
        activeMilestone: 'completed',
        activeDeadline: null,
      };
    }

    const deadlineTime = activeDeadline!.getTime();
    const isLate = now.getTime() > deadlineTime || (
      activeMilestone === 'first_response' ? ticket.first_response_breached : ticket.resolution_breached
    );

    if (now.getTime() > deadlineTime) {
      const overdueWorkingMinutes = workingMinutesBetween(activeDeadline!, now, holidays);
      return {
        isLate: true,
        lateMilestone: activeMilestone,
        overdueWorkingMinutes,
        timeRemainingWorkingMinutes: 0,
        isPaused,
        activeMilestone,
        activeDeadline,
      };
    }

    const timeRemainingWorkingMinutes = Math.max(
      0,
      workingMinutesBetween(now, activeDeadline!, holidays)
    );

    return {
      isLate: false,
      overdueWorkingMinutes: 0,
      timeRemainingWorkingMinutes,
      isPaused,
      activeMilestone,
      activeDeadline,
    };
  }
}
