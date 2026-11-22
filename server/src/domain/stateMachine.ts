import { TicketStatus, InvalidStateTransitionError } from './types.js';

/**
 * Frontdesk Status Model (R11):
 * NEW (unassigned) -> OPEN (assigned) <-> WAITING_CUSTOMER -> RESOLVED -> CLOSED
 * RESOLVED -> OPEN (reopen within window)
 * OPEN -> NEW (release ticket back to queue)
 * WAITING_CUSTOMER -> CLOSED (auto-close after customer silent)
 */
export const VALID_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['OPEN'],
  OPEN: ['WAITING_CUSTOMER', 'RESOLVED', 'NEW'],
  WAITING_CUSTOMER: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [], // Terminal state. Reopen after closed requires creating a new linked ticket (R3, R4)
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  if (from === to) return true;
  const allowed = VALID_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function assertValidTransition(from: TicketStatus, to: TicketStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(
      from,
      to,
      `Cannot transition ticket from status '${from}' to '${to}'`
    );
  }
}

