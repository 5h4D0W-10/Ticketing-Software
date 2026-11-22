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

export function formatDurationCompact(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) {
    return `${rounded}m`;
  }
  const hours = Math.floor(rounded / 60);
  const remainingMinutes = rounded % 60;
  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h${remainingMinutes}m`;
}

export function formatDaysOrHours(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded % 540 === 0 && rounded >= 540) {
    const days = rounded / 540;
    return `${days} working day${days > 1 ? 's' : ''}`;
  }
  if (rounded >= 540) {
    const days = (rounded / 540).toFixed(1);
    return `${days} working days`;
  }
  return formatDurationCompact(rounded);
}

export const formatWorkingDuration = formatDaysOrHours;

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

    // 1. Analyze Claim timing (e.g. "not claimed for 3h10m")
    if (ticket.claimed_at) {
      const timeToClaim = workingMinutesBetween(
        new Date(ticket.clock_start),
        new Date(ticket.claimed_at),
        holidays
      );
      if (new Date(ticket.claimed_at).getTime() > new Date(ticket.response_due_at).getTime()) {
        reasons.push(`not claimed for ${formatDurationCompact(timeToClaim)}`);
      } else if (timeToClaim > 120) {
        reasons.push(`not claimed for ${formatDurationCompact(timeToClaim)}`);
      }
    } else if (ticket.assignee_id === null) {
      const unclaimedDuration = workingMinutesBetween(new Date(ticket.clock_start), now, holidays);
      reasons.push(`not claimed for ${formatDurationCompact(unclaimedDuration)}`);
    }

    // 2. Analyze First response timing (e.g. "first reply 45 working min after deadline")
    if (ticket.first_response_at) {
      const responseDate = new Date(ticket.first_response_at);
      const responseDueDate = new Date(ticket.response_due_at);
      if (responseDate.getTime() > responseDueDate.getTime()) {
        const lateMinutes = workingMinutesBetween(responseDueDate, responseDate, holidays);
        reasons.push(`first reply ${Math.round(lateMinutes)} working min after deadline`);
      }
    } else if (now.getTime() > new Date(ticket.response_due_at).getTime()) {
      const overdueMinutes = workingMinutesBetween(new Date(ticket.response_due_at), now, holidays);
      reasons.push(`first reply ${Math.round(overdueMinutes)} working min after deadline`);
    }

    // 3. Analyze Resolution timing (e.g. "resolution overdue by 1 working day")
    if (ticket.resolved_at) {
      const resolvedDate = new Date(ticket.resolved_at);
      const resolutionDueDate = new Date(ticket.resolution_due_at);
      if (resolvedDate.getTime() > resolutionDueDate.getTime()) {
        const lateMinutes = workingMinutesBetween(resolutionDueDate, resolvedDate, holidays);
        reasons.push(`resolution overdue by ${formatDaysOrHours(lateMinutes)}`);
      }
    } else if (now.getTime() > new Date(ticket.resolution_due_at).getTime()) {
      const overdueMinutes = workingMinutesBetween(new Date(ticket.resolution_due_at), now, holidays);
      reasons.push(`resolution overdue by ${formatDaysOrHours(overdueMinutes)}`);
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
      excludedCustomerWaitingFormatted: formatDaysOrHours(totalPausedMinutes),
    });
  }

  return lateTickets;
}
