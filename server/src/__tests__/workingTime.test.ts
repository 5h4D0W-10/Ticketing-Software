import { describe, it, expect } from 'vitest';
import {
  createIstDate,
  toIstDateString,
  getIstComponents,
  isWorkingDay,
  isWorkingTime,
  getEffectiveClockStart,
  nextWorkingStart,
  addWorkingMinutes,
  workingMinutesBetween,
} from '../time/workingTime.js';
import { computeDeadlines } from '../time/slaPolicy.js';

describe('Working-Time Engine (Asia/Kolkata)', () => {
  // Test calendar context:
  // Friday: 2026-11-20
  // Saturday: 2026-11-21
  // Sunday: 2026-11-22
  // Monday: 2026-11-23
  // Tuesday: 2026-11-24
  // Wednesday: 2026-11-25
  // Thursday: 2026-11-26
  // Friday: 2026-11-27

  it('verifies Friday 6 PM ticket is NOT late Sunday morning', () => {
    // Ticket arriving Friday 6:00 PM (18:00 IST)
    const ticketCreated = createIstDate(2026, 11, 20, 18, 0, 0);
    const deadlines = computeDeadlines(ticketCreated, 'Urgent');

    // First response for Urgent is 2 working hours (120 working minutes)
    // Friday remaining: 30 minutes (18:00 to 18:30)
    // Saturday & Sunday: non-working
    // Monday: 90 remaining minutes from 09:30 -> due at Monday 11:00 AM IST
    const expectedDueAt = createIstDate(2026, 11, 23, 11, 0, 0);
    expect(deadlines.responseDueAt.toISOString()).toBe(expectedDueAt.toISOString());

    // Sunday morning at 10:00 AM IST
    const sundayMorning = createIstDate(2026, 11, 22, 10, 0, 0);

    // Elapsed working minutes from creation to Sunday morning is only 30 working minutes
    const elapsedWorkingMinutes = workingMinutesBetween(ticketCreated, sundayMorning);
    expect(elapsedWorkingMinutes).toBe(30);

    // It is NOT late on Sunday morning
    const isLate = sundayMorning.getTime() > deadlines.responseDueAt.getTime();
    expect(isLate).toBe(false);
  });

  it('handles Saturday and Sunday correctly', () => {
    const saturday = createIstDate(2026, 11, 21, 14, 0, 0);
    const sunday = createIstDate(2026, 11, 22, 11, 30, 0);

    expect(isWorkingDay(saturday)).toBe(false);
    expect(isWorkingDay(sunday)).toBe(false);
    expect(isWorkingTime(saturday)).toBe(false);
    expect(isWorkingTime(sunday)).toBe(false);

    // Tickets created on weekend start their clock on Monday 09:30 AM IST
    const expectedMondayStart = createIstDate(2026, 11, 23, 9, 30, 0);
    expect(getEffectiveClockStart(saturday).toISOString()).toBe(expectedMondayStart.toISOString());
    expect(getEffectiveClockStart(sunday).toISOString()).toBe(expectedMondayStart.toISOString());

    // Working minutes between weekend timestamps is 0
    expect(workingMinutesBetween(saturday, sunday)).toBe(0);
  });

  it('handles holiday in the middle correctly', () => {
    // Wednesday 2026-11-25 is marked as a festival holiday
    const holidays = ['2026-11-25'];

    // Ticket created Tuesday 2026-11-24 at 16:30 IST (2 hours / 120m before 18:30)
    const tuesday = createIstDate(2026, 11, 24, 16, 30, 0);

    // Add 1 working day (540 minutes / 9 hours)
    // Tuesday: 120m elapsed (16:30 - 18:30). Remaining: 420m
    // Wednesday: holiday (0m)
    // Thursday: 420m (7 hours) from 09:30 -> Thursday 16:30 IST
    const dueAt = addWorkingMinutes(tuesday, 540, holidays);
    const expectedThursday = createIstDate(2026, 11, 26, 16, 30, 0);

    expect(dueAt.toISOString()).toBe(expectedThursday.toISOString());
    expect(workingMinutesBetween(tuesday, dueAt, holidays)).toBe(540);
  });

  it('handles tickets spanning a weekend correctly', () => {
    // Ticket created Friday 2026-11-20 at 15:30 IST (3 hours / 180m before 18:30)
    const friday = createIstDate(2026, 11, 20, 15, 30, 0);

    // Add 1620 working minutes (Medium resolution: 3 working days = 27 working hours)
    // Friday: 180m
    // Monday: 540m
    // Tuesday: 540m
    // Wednesday: 360m (09:30 to 15:30)
    const dueAt = addWorkingMinutes(friday, 1620);
    const expectedWednesday = createIstDate(2026, 11, 25, 15, 30, 0);

    expect(dueAt.toISOString()).toBe(expectedWednesday.toISOString());
    expect(workingMinutesBetween(friday, dueAt)).toBe(1620);
  });

  it('evaluates exact boundaries at 9:30 and 18:30', () => {
    const monday930 = createIstDate(2026, 11, 23, 9, 30, 0, 0);
    const monday92959 = createIstDate(2026, 11, 23, 9, 29, 59, 999);
    const monday1830 = createIstDate(2026, 11, 23, 18, 30, 0, 0);
    const monday183001 = createIstDate(2026, 11, 23, 18, 30, 1, 0);

    // Boundary at 09:30:00
    expect(isWorkingTime(monday930)).toBe(true);
    expect(isWorkingTime(monday92959)).toBe(false);
    expect(getEffectiveClockStart(monday930).toISOString()).toBe(monday930.toISOString());

    // Boundary at 18:30:00
    expect(isWorkingTime(monday1830)).toBe(true);
    expect(isWorkingTime(monday183001)).toBe(false);

    // Workday end: a ticket submitted at or after 18:30 starts its clock next working day at 09:30
    const tuesday930 = createIstDate(2026, 11, 24, 9, 30, 0, 0);
    expect(getEffectiveClockStart(monday1830).toISOString()).toBe(tuesday930.toISOString());
    expect(getEffectiveClockStart(monday183001).toISOString()).toBe(tuesday930.toISOString());

    // Full working day span is exactly 540 working minutes
    expect(workingMinutesBetween(monday930, monday1830)).toBe(540);
    expect(addWorkingMinutes(monday930, 540).toISOString()).toBe(monday1830.toISOString());
  });

  it('handles tickets created before 9:30 correctly', () => {
    // Ticket created Monday at 07:45 IST (before working hours)
    const earlyTicket = createIstDate(2026, 11, 23, 7, 45, 0);
    expect(isWorkingTime(earlyTicket)).toBe(false);

    const clockStart = getEffectiveClockStart(earlyTicket);
    const expectedStart = createIstDate(2026, 11, 23, 9, 30, 0);
    expect(clockStart.toISOString()).toBe(expectedStart.toISOString());

    // Deadlines calculated from 09:30
    const deadlines = computeDeadlines(earlyTicket, 'Urgent');
    expect(deadlines.clockStart.toISOString()).toBe(expectedStart.toISOString());
    expect(deadlines.responseDueAt.toISOString()).toBe(createIstDate(2026, 11, 23, 11, 30, 0).toISOString());
    expect(deadlines.resolutionDueAt.toISOString()).toBe(createIstDate(2026, 11, 23, 18, 30, 0).toISOString());
  });

  it('guarantees round-trip consistency between addWorkingMinutes and workingMinutesBetween', () => {
    const testMinutes = [15, 60, 120, 270, 540, 1080, 1620, 2700];
    const holidays = ['2026-11-26'];
    const start = createIstDate(2026, 11, 23, 11, 15, 0);

    for (const minutes of testMinutes) {
      const destination = addWorkingMinutes(start, minutes, holidays);
      const computedMinutes = workingMinutesBetween(start, destination, holidays);
      expect(computedMinutes).toBe(minutes);
    }
  });
});

