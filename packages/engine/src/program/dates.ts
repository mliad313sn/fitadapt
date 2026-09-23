import { WEEKDAYS, type IsoDate, type Weekday } from '@fitadapt/shared';

/**
 * Calendar-date arithmetic on 'YYYY-MM-DD' strings (the user's local
 * calendar, no time zone). UTC is used only as a neutral calendar; no clock
 * is read.
 */
const DAY_MS = 86_400_000;

export function toDayNumber(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: IsoDate): number {
  // Day 0 (1970-01-01) was a Thursday.
  return (((toDayNumber(date) + 3) % 7) + 7) % 7;
}

export function weekdayOf(date: IsoDate): Weekday {
  return WEEKDAYS[weekdayIndex(date)]!;
}

/** The Monday on or after `date`. */
export function mondayOnOrAfter(date: IsoDate): IsoDate {
  const i = weekdayIndex(date);
  return i === 0 ? date : addDays(date, 7 - i);
}

/** The Monday of the week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  return addDays(date, -weekdayIndex(date));
}
