// Asia/Kolkata Working Time Engine
// Working time: 9:30 to 18:30 (9 hours / 540 minutes per day), Monday to Friday.
// Timezone: Asia/Kolkata (fixed UTC+05:30 offset, 330 minutes, 19,800,000 ms). No DST.

export const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // 19,800,000 ms
export const WORKDAY_START_MINUTE = 9 * 60 + 30; // 570 (09:30)
export const WORKDAY_END_MINUTE = 18 * 60 + 30;  // 1110 (18:30)
export const WORKDAY_MINUTES = WORKDAY_END_MINUTE - WORKDAY_START_MINUTE; // 540 minutes

export type HolidayInput = Set<string> | string[] | Date[];

export interface IstComponents {
  year: number;
  month: number; // 1 - 12
  day: number;   // 1 - 31
  dayOfWeek: number; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  hours: number;
  minutes: number;
  seconds: number;
  milliseconds: number;
  dateString: string; // YYYY-MM-DD
  minuteOfDay: number;
}

/**
 * Converts a UTC Date into its exact components in Asia/Kolkata (IST).
 */
export function getIstComponents(d: Date): IstComponents {
  const istDate = new Date(d.getTime() + IST_OFFSET_MS);
  const year = istDate.getUTCFullYear();
  const month = istDate.getUTCMonth() + 1;
  const day = istDate.getUTCDate();
  const dayOfWeek = istDate.getUTCDay();
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const seconds = istDate.getUTCSeconds();
  const milliseconds = istDate.getUTCMilliseconds();

  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  const dateString = `${year}-${monthStr}-${dayStr}`;
  const minuteOfDay = hours * 60 + minutes;

  return {
    year,
    month,
    day,
    dayOfWeek,
    hours,
    minutes,
    seconds,
    milliseconds,
    dateString,
    minuteOfDay,
  };
}

/**
 * Creates a UTC Date given exact calendar components in Asia/Kolkata.
 */
export function createIstDate(
  year: number,
  month: number, // 1 - 12
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  milliseconds = 0
): Date {
  const utcMillis = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds) - IST_OFFSET_MS;
  return new Date(utcMillis);
}

/**
 * Converts a Date to 'YYYY-MM-DD' in Asia/Kolkata.
 */
export function toIstDateString(d: Date): string {
  return getIstComponents(d).dateString;
}

/**
 * Normalizes holiday input into a Set of 'YYYY-MM-DD' strings.
 */
export function normalizeHolidays(holidays?: HolidayInput): Set<string> {
  if (!holidays) return new Set();
  if (holidays instanceof Set) return holidays;

  const result = new Set<string>();
  for (const h of holidays) {
    if (typeof h === 'string') {
      result.add(h);
    } else if (h instanceof Date) {
      result.add(toIstDateString(h));
    }
  }
  return result;
}

/**
 * Checks whether a given calendar date in IST is a working day (Mon-Fri and not a holiday).
 */
export function isWorkingDay(d: Date, holidays?: HolidayInput): boolean {
  const ist = getIstComponents(d);
  if (ist.dayOfWeek === 0 || ist.dayOfWeek === 6) {
    return false; // Sunday or Saturday
  }
  const holidaySet = normalizeHolidays(holidays);
  if (holidaySet.has(ist.dateString)) {
    return false;
  }
  return true;
}

/**
 * Checks whether a timestamp falls within working hours [09:30, 18:30] on a working day.
 */
export function isWorkingTime(t: Date, holidays?: HolidayInput): boolean {
  if (!isWorkingDay(t, holidays)) {
    return false;
  }
  const ist = getIstComponents(t);
  const timeInMinutes = ist.hours * 60 + ist.minutes + ist.seconds / 60 + ist.milliseconds / 3600000;
  return timeInMinutes >= WORKDAY_START_MINUTE && timeInMinutes <= WORKDAY_END_MINUTE;
}

/**
 * Returns the start of the workday (09:30:00.000 IST) for the same date.
 */
export function getStartOfWorkingDay(d: Date): Date {
  const ist = getIstComponents(d);
  return createIstDate(ist.year, ist.month, ist.day, 9, 30, 0, 0);
}

/**
 * Returns the end of the workday (18:30:00.000 IST) for the same date.
 */
export function getEndOfWorkingDay(d: Date): Date {
  const ist = getIstComponents(d);
  return createIstDate(ist.year, ist.month, ist.day, 18, 30, 0, 0);
}

/**
 * Finds the next 09:30:00 IST start of a working day.
 * - If `t` is on a working day and strictly before 09:30, returns today's 09:30.
 * - If `t` is at or after 09:30 on a working day, or on a non-working day, advances to the next working day's 09:30.
 */
export function nextWorkingStart(t: Date, holidays?: HolidayInput): Date {
  const holidaySet = normalizeHolidays(holidays);
  const ist = getIstComponents(t);

  // If today is a working day and t is before 09:30:00.000
  if (isWorkingDay(t, holidaySet)) {
    const todayStart = getStartOfWorkingDay(t);
    if (t.getTime() <= todayStart.getTime()) {
      return todayStart;
    }
  }

  // Otherwise, advance day-by-day starting tomorrow
  let candidate = createIstDate(ist.year, ist.month, ist.day + 1, 9, 30, 0, 0);
  while (!isWorkingDay(candidate, holidaySet)) {
    const nextIst = getIstComponents(candidate);
    candidate = createIstDate(nextIst.year, nextIst.month, nextIst.day + 1, 9, 30, 0, 0);
  }

  return candidate;
}

/**
 * Determines when the SLA clock starts for a newly created ticket.
 * - If created within working hours (09:30 to 18:30 exclusive of 18:30 end), returns t.
 * - If created outside working hours (or at 18:30 when the day ends), returns nextWorkingStart(t).
 */
export function getEffectiveClockStart(t: Date, holidays?: HolidayInput): Date {
  const holidaySet = normalizeHolidays(holidays);
  const ist = getIstComponents(t);

  if (isWorkingDay(t, holidaySet)) {
    const todayStart = getStartOfWorkingDay(t);
    const todayEnd = getEndOfWorkingDay(t);

    if (t.getTime() >= todayStart.getTime() && t.getTime() < todayEnd.getTime()) {
      return t;
    }
  }

  return nextWorkingStart(t, holidaySet);
}

/**
 * Adds N working minutes to a starting timestamp, skipping non-working hours, weekends, and holidays.
 */
export function addWorkingMinutes(start: Date, minutes: number, holidays?: HolidayInput): Date {
  if (minutes < 0) {
    throw new Error('Working minutes cannot be negative');
  }

  const holidaySet = normalizeHolidays(holidays);
  let curr = getEffectiveClockStart(start, holidaySet);

  if (minutes === 0) {
    return curr;
  }

  let remainingMinutes = minutes;

  while (remainingMinutes > 0) {
    const todayEnd = getEndOfWorkingDay(curr);
    const msAvailableToday = todayEnd.getTime() - curr.getTime();
    const minutesAvailableToday = msAvailableToday / 60000;

    if (remainingMinutes <= minutesAvailableToday) {
      return new Date(curr.getTime() + remainingMinutes * 60000);
    }

    remainingMinutes -= minutesAvailableToday;
    curr = nextWorkingStart(todayEnd, holidaySet);
  }

  return curr;
}

/**
 * Calculates the exact working minutes elapsed between timestamp a and timestamp b.
 * Excludes weekends, non-working hours, and holidays.
 */
export function workingMinutesBetween(a: Date, b: Date, holidays?: HolidayInput): number {
  if (a.getTime() === b.getTime()) {
    return 0;
  }
  if (a.getTime() > b.getTime()) {
    return -workingMinutesBetween(b, a, holidays);
  }

  const holidaySet = normalizeHolidays(holidays);
  let totalMs = 0;

  // Clamp start pointer
  let curr = new Date(a.getTime());
  const end = new Date(b.getTime());

  while (curr.getTime() < end.getTime()) {
    if (isWorkingDay(curr, holidaySet)) {
      const dayStart = getStartOfWorkingDay(curr);
      const dayEnd = getEndOfWorkingDay(curr);

      // Active working window for today
      const windowStart = Math.max(curr.getTime(), dayStart.getTime());
      const windowEnd = Math.min(end.getTime(), dayEnd.getTime());

      if (windowStart < windowEnd) {
        totalMs += (windowEnd - windowStart);
      }
    }

    // Advance to next day at 09:30:00 IST
    const ist = getIstComponents(curr);
    curr = createIstDate(ist.year, ist.month, ist.day + 1, 9, 30, 0, 0);
  }

  return totalMs / 60000;
}
