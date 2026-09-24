import { isValidCalendarDate, type CalendarDate } from '@fitadapt/safety';

const DAY_MS = 86_400_000;
const utcDate = (ms: number): CalendarDate => {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};
const dayNumber = (d: CalendarDate) => Date.UTC(d.year, d.month - 1, d.day) / DAY_MS;

/**
 * SAF-12: the calendar date the S7 age gate is evaluated on — the earlier of
 * the user's local date and the engine clock's UTC date (a user west of UTC
 * never passes the gate before their local birthday). Without a local date,
 * the day before the UTC date (fail closed). Null when the local date is not
 * a real date or is more than one day from the clock's UTC date (no time zone
 * is that far): the device clock or date is wrong, and the engine refuses
 * rather than evaluate safety windows at a time nothing bounds (SAF-5).
 */
export function ageGateDate(localDate: CalendarDate | null, nowMs: number): CalendarDate | null {
  const utc = utcDate(nowMs);
  if (localDate === null) return utcDate(nowMs - DAY_MS);
  if (!isValidCalendarDate(localDate)) return null;
  const diff = dayNumber(localDate) - dayNumber(utc);
  if (Math.abs(diff) > 1) return null;
  return diff < 0 ? localDate : utc;
}
