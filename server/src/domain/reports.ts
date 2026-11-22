import { DbClient } from '../db/transaction.js';
import { workingMinutesBetween, HolidayInput } from '../time/workingTime.js';
import { TicketService } from './ticketService.js';
import { TicketRow } from './types.js';

export interface LateTicketReportItem {
  id: string;
  ticketNumber: number;
  subject: string;
  priority: string;
  status: string;
  assigneeName: string | null;
  customerName: string;
  clockStart: string;
  responseDueAt: string;
  resolutionDueAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  reasons: string[];
  excludedCustomerWaitingMinutes: number;
  excludedCustomerWaitingFormatted: string;
}

export function formatWorkingDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  if (hours >= 9) {
    const days = (minutes / 540).toFixed(1);
    return `${days} working day(s) (${hours}h ${remainingMinutes}m)`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

export async function generateLateTicketsReport(
  db: DbClient,
  ticketService: TicketService,
  now: Date,
  holidays?: HolidayInput
): Promise<LateTicketReportItem[]> {
  // Query all tickets with their customer, assignee, and events
  const res = await db.query<
    TicketRow & {
      customer_name: string;
      assignee_name: string | null;
      claimed_at: Date | null;
    }
  >(
    `SELECT t.*,
            c.name as customer_name,
            u.name as assignee_name,
            (SELECT occurred_at FROM ticket_events WHERE ticket_id = t.id AND event_type = 'claimed' ORDER BY occurred_at ASC LIMIT 1) as claimed_at
     FROM tickets t
     JOIN customers c ON t.customer_id = c.id
     LEFT JOIN users u ON t.assignee_id = u.id
     ORDER BY t.created_at DESC;`
  );

  const lateTickets: LateTicketReportItem[] = [];

  for (const ticket of res.rows) {
    const slaStatus = ticketService.computeTicketSlaStatus(ticket, now, holidays);
    const hasBreached = ticket.first_response_breached || ticket.resolution_breached || slaStatus.isLate;

    if (!hasBreached) {
      continue;
    }

    const reasons: string[] = [];

    // 1. Analyze Claim timing
    if (ticket.claimed_at) {
      const timeToClaim = workingMinutesBetween(
        new Date(ticket.clock_start),
        new Date(ticket.claimed_at),
        holidays
      );
      if (new Date(ticket.claimed_at).getTime() > new Date(ticket.response_due_at).getTime()) {
        reasons.push(`Not claimed until after response deadline (took ${formatWorkingDuration(timeToClaim)})`);
      } else if (timeToClaim > 120) {
        reasons.push(`Claim delayed by ${formatWorkingDuration(timeToClaim)}`);
      }
    } else if (ticket.assignee_id === null) {
      const unclaimedDuration = workingMinutesBetween(new Date(ticket.clock_start), now, holidays);
      reasons.push(`Currently unassigned (unclaimed for ${formatWorkingDuration(unclaimedDuration)})`);
    }

    // 2. Analyze First response timing
    if (ticket.first_response_at) {
      const responseDate = new Date(ticket.first_response_at);
      const responseDueDate = new Date(ticket.response_due_at);
      if (responseDate.getTime() > responseDueDate.getTime()) {
        const lateMinutes = workingMinutesBetween(responseDueDate, responseDate, holidays);
        reasons.push(`First reply was ${formatWorkingDuration(lateMinutes)} after deadline`);
      }
    } else if (now.getTime() > new Date(ticket.response_due_at).getTime()) {
      const overdueMinutes = workingMinutesBetween(new Date(ticket.response_due_at), now, holidays);
      reasons.push(`First reply overdue by ${formatWorkingDuration(overdueMinutes)}`);
    }

    // 3. Analyze Resolution timing
    if (ticket.resolved_at) {
      const resolvedDate = new Date(ticket.resolved_at);
      const resolutionDueDate = new Date(ticket.resolution_due_at);
      if (resolvedDate.getTime() > resolutionDueDate.getTime()) {
        const lateMinutes = workingMinutesBetween(resolutionDueDate, resolvedDate, holidays);
        reasons.push(`Resolution overdue by ${formatWorkingDuration(lateMinutes)}`);
      }
    } else if (now.getTime() > new Date(ticket.resolution_due_at).getTime()) {
      const overdueMinutes = workingMinutesBetween(new Date(ticket.resolution_due_at), now, holidays);
      reasons.push(`Resolution overdue by ${formatWorkingDuration(overdueMinutes)}`);
    }

    if (reasons.length === 0) {
      reasons.push('SLA deadline exceeded');
    }

    // 4. Calculate total customer waiting paused time
    const totalPausedMinutes = await ticketService.getTotalPausedWorkingMinutes(
      db,
      ticket.id,
      ticket.cycle,
      now,
      holidays
    );

    lateTickets.push({
      id: ticket.id,
      ticketNumber: ticket.ticket_number,
      subject: ticket.subject,
      priority: ticket.priority,
      status: ticket.status,
      assigneeName: ticket.assignee_name,
      customerName: ticket.customer_name,
      clockStart: new Date(ticket.clock_start).toISOString(),
      responseDueAt: new Date(ticket.response_due_at).toISOString(),
      resolutionDueAt: new Date(ticket.resolution_due_at).toISOString(),
      firstResponseAt: ticket.first_response_at ? new Date(ticket.first_response_at).toISOString() : null,
      resolvedAt: ticket.resolved_at ? new Date(ticket.resolved_at).toISOString() : null,
      reasons,
      excludedCustomerWaitingMinutes: totalPausedMinutes,
      excludedCustomerWaitingFormatted: formatWorkingDuration(totalPausedMinutes),
    });
  }

  return lateTickets;
}
