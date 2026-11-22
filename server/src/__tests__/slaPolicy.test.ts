import { describe, it, expect } from 'vitest';
import { createIstDate } from '../time/workingTime.js';
import {
  SLA_TARGETS,
  computeDeadlines,
  recomputeDeadlinesOnPriorityChange,
} from '../time/slaPolicy.js';

describe('SLA Policy Module', () => {
  it('maps targets correctly per docs/SPEC.md R1', () => {
    expect(SLA_TARGETS.Urgent.responseMinutes).toBe(120);
    expect(SLA_TARGETS.Urgent.resolutionMinutes).toBe('SAME_WORKING_DAY');

    expect(SLA_TARGETS.Medium.responseMinutes).toBe(270);
    expect(SLA_TARGETS.Medium.resolutionMinutes).toBe(1620);

    expect(SLA_TARGETS.Small.responseMinutes).toBe(540);
    expect(SLA_TARGETS.Small.resolutionMinutes).toBe(2700);
  });

  it('enforces the Urgent same-working-day resolution rule', () => {
    // Case 1: Urgent ticket created Monday morning 10:15 IST
    const morningTicket = createIstDate(2026, 11, 23, 10, 15, 0);
    const morningDeadlines = computeDeadlines(morningTicket, 'Urgent');
    expect(morningDeadlines.resolutionDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 23, 18, 30, 0).toISOString()
    );

    // Case 2: Urgent ticket created Friday late afternoon 17:45 IST
    const lateFridayTicket = createIstDate(2026, 11, 20, 17, 45, 0);
    const fridayDeadlines = computeDeadlines(lateFridayTicket, 'Urgent');
    expect(fridayDeadlines.resolutionDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 20, 18, 30, 0).toISOString()
    );

    // Case 3: Urgent ticket created Sunday 14:00 (outside working hours)
    // Clock starts Monday 09:30, resolution due Monday 18:30 IST
    const sundayTicket = createIstDate(2026, 11, 22, 14, 0, 0);
    const sundayDeadlines = computeDeadlines(sundayTicket, 'Urgent');
    expect(sundayDeadlines.clockStart.toISOString()).toBe(
      createIstDate(2026, 11, 23, 9, 30, 0).toISOString()
    );
    expect(sundayDeadlines.resolutionDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 23, 18, 30, 0).toISOString()
    );
  });

  it('recomputes deadlines on priority change mid-ticket (upgrade and downgrade)', () => {
    // Ticket originally created Monday 10:00 IST as Medium
    const clockStart = createIstDate(2026, 11, 23, 10, 0, 0);

    // Upgrade to Urgent (no paused time)
    const upgraded = recomputeDeadlinesOnPriorityChange(clockStart, 'Urgent', 0);
    // Response due 10:00 + 120m = 12:00 IST
    expect(upgraded.responseDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 23, 12, 0, 0).toISOString()
    );
    // Resolution due same day 18:30 IST
    expect(upgraded.resolutionDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 23, 18, 30, 0).toISOString()
    );

    // Downgrade to Small with 60 paused working minutes
    const downgraded = recomputeDeadlinesOnPriorityChange(clockStart, 'Small', 60);
    // Small response: 540m + 60m paused = 600m
    // From 10:00: 510m left on Monday -> 18:30; Tuesday 90m -> Tuesday 11:00 IST
    expect(downgraded.responseDueAt.toISOString()).toBe(
      createIstDate(2026, 11, 24, 11, 0, 0).toISOString()
    );
  });
});
