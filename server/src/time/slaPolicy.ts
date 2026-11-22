import {
  HolidayInput,
  getEffectiveClockStart,
  getEndOfWorkingDay,
  addWorkingMinutes,
} from './workingTime.js';

export type TicketPriority = 'Urgent' | 'Medium' | 'Small';

export interface SlaPolicyTarget {
  responseMinutes: number;
  resolutionMinutes: number | 'SAME_WORKING_DAY';
}

/**
 * Standard Frontdesk SLA targets:
 * - Urgent: 2 working hours (120m) first response, same working day resolution (by 18:30 IST)
 * - Medium: Half a working day (4.5h = 270m) first response, ~3 working days (27h = 1620m) resolution
 * - Small: 1 working day (9h = 540m) first response, ~1 working week (5 working days = 45h = 2700m) resolution
 */
export const SLA_TARGETS: Record<TicketPriority, SlaPolicyTarget> = {
  Urgent: {
    responseMinutes: 120, // 2 working hours
    resolutionMinutes: 'SAME_WORKING_DAY',
  },
  Medium: {
    responseMinutes: 270, // 4.5 working hours
    resolutionMinutes: 1620, // 27 working hours (3 working days)
  },
  Small: {
    responseMinutes: 540, // 9 working hours (1 working day)
    resolutionMinutes: 2700, // 45 working hours (5 working days / 1 working week)
  },
};

export interface Deadlines {
  clockStart: Date;
  responseDueAt: Date;
  resolutionDueAt: Date;
}

/**
 * Computes response due date based on clock start and priority.
 */
export function getResponseDueAt(
  clockStart: Date,
  priority: TicketPriority,
  holidays?: HolidayInput
): Date {
  const minutes = SLA_TARGETS[priority].responseMinutes;
  return addWorkingMinutes(clockStart, minutes, holidays);
}

/**
 * Computes resolution due date based on clock start and priority.
 * For Urgent tickets, due at 18:30 IST on the day the clock starts.
 */
export function getResolutionDueAt(
  clockStart: Date,
  priority: TicketPriority,
  holidays?: HolidayInput
): Date {
  if (priority === 'Urgent') {
    return getEndOfWorkingDay(clockStart);
  }
  const minutes = SLA_TARGETS[priority].resolutionMinutes as number;
  return addWorkingMinutes(clockStart, minutes, holidays);
}

/**
 * Computes the full SLA deadlines for a ticket given its creation time and priority.
 */
export function computeDeadlines(
  createdAt: Date,
  priority: TicketPriority,
  holidays?: HolidayInput
): Deadlines {
  const clockStart = getEffectiveClockStart(createdAt, holidays);
  const responseDueAt = getResponseDueAt(clockStart, priority, holidays);
  const resolutionDueAt = getResolutionDueAt(clockStart, priority, holidays);

  return {
    clockStart,
    responseDueAt,
    resolutionDueAt,
  };
}

/**
 * Recomputes deadlines on priority change mid-ticket:
 * Recomputes both deadlines from original clock start using new priority targets,
 * then moves forward by already elapsed paused working minutes.
 */
export function recomputeDeadlinesOnPriorityChange(
  originalClockStart: Date,
  newPriority: TicketPriority,
  totalPausedWorkingMinutes = 0,
  holidays?: HolidayInput
): { responseDueAt: Date; resolutionDueAt: Date } {
  let responseDueAt = getResponseDueAt(originalClockStart, newPriority, holidays);
  let resolutionDueAt = getResolutionDueAt(originalClockStart, newPriority, holidays);

  if (totalPausedWorkingMinutes > 0) {
    responseDueAt = addWorkingMinutes(responseDueAt, totalPausedWorkingMinutes, holidays);
    resolutionDueAt = addWorkingMinutes(resolutionDueAt, totalPausedWorkingMinutes, holidays);
  }

  return { responseDueAt, resolutionDueAt };
}

