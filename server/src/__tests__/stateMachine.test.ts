import { describe, it, expect } from 'vitest';
import {
  canTransition,
  assertValidTransition,
  VALID_TRANSITIONS,
} from '../domain/stateMachine.js';
import { TicketStatus, InvalidStateTransitionError } from '../domain/types.js';

describe('Frontdesk State Machine (R11)', () => {
  it('allows all valid transitions defined in specification', () => {
    // NEW -> OPEN
    expect(canTransition('NEW', 'OPEN')).toBe(true);
    expect(() => assertValidTransition('NEW', 'OPEN')).not.toThrow();

    // OPEN -> WAITING_CUSTOMER, RESOLVED, NEW (release)
    expect(canTransition('OPEN', 'WAITING_CUSTOMER')).toBe(true);
    expect(canTransition('OPEN', 'RESOLVED')).toBe(true);
    expect(canTransition('OPEN', 'NEW')).toBe(true);

    // WAITING_CUSTOMER -> OPEN, RESOLVED, CLOSED
    expect(canTransition('WAITING_CUSTOMER', 'OPEN')).toBe(true);
    expect(canTransition('WAITING_CUSTOMER', 'RESOLVED')).toBe(true);
    expect(canTransition('WAITING_CUSTOMER', 'CLOSED')).toBe(true);

    // RESOLVED -> OPEN (reopen within window), CLOSED
    expect(canTransition('RESOLVED', 'OPEN')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);

    // Identity transition (no-op)
    const allStatuses: TicketStatus[] = ['NEW', 'OPEN', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED'];
    for (const s of allStatuses) {
      expect(canTransition(s, s)).toBe(true);
    }
  });

  it('rejects invalid transitions and throws typed InvalidStateTransitionError', () => {
    const invalidPairs: [TicketStatus, TicketStatus][] = [
      ['NEW', 'WAITING_CUSTOMER'],
      ['NEW', 'RESOLVED'],
      ['NEW', 'CLOSED'],
      ['CLOSED', 'OPEN'],
      ['CLOSED', 'WAITING_CUSTOMER'],
      ['CLOSED', 'RESOLVED'],
      ['RESOLVED', 'WAITING_CUSTOMER'],
    ];

    for (const [from, to] of invalidPairs) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertValidTransition(from, to)).toThrowError(InvalidStateTransitionError);

      try {
        assertValidTransition(from, to);
      } catch (err: unknown) {
        const error = err as InvalidStateTransitionError;
        expect(error.statusCode).toBe(422);
        expect(error.fromStatus).toBe(from);
        expect(error.toStatus).toBe(to);
      }
    }
  });
});
