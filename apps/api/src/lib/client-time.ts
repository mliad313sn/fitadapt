import { ApiError } from '../auth/errors.js';
import { privacyValue } from '../config/privacy.config.js';

const DAY_MS = 86_400_000;

/**
 * True when a device time is plausible against the server's clock: not in
 * the future beyond clock skew, not older than the offline window. The one
 * rule for every client time the server accepts (M01, ADR-013; API-5,
 * SAF-5: synced records whose time drives a safety re-check).
 */
export function clientTimeInRange(at: string, now: Date): boolean {
  const t = Date.parse(at);
  const skew = privacyValue('clientClockSkewSeconds') * 1000;
  const window = privacyValue('offlineRecordMaxAgeSeconds') * 1000;
  return !Number.isNaN(t) && t <= now.getTime() + skew && t >= now.getTime() - window;
}

/**
 * Time a record was made on the device (M01, ADR-013). Decisions taken offline
 * are uploaded later with their device time; the server keeps its own receipt
 * time beside it. A device time in the future (beyond clock skew) or older
 * than the offline window is refused, so a client cannot backdate at will.
 */
export function clientTime(at: string | undefined, now: Date, code: string): Date {
  if (at === undefined) return now;
  if (!clientTimeInRange(at, now)) throw new ApiError(400, code);
  return new Date(Math.min(Date.parse(at), now.getTime()));
}

/**
 * True when a local calendar date (YYYY-MM-DD) can be "today" somewhere on
 * Earth at some instant of the offline window: not after the latest date on
 * Earth now (UTC+14), not before the earliest date on Earth (UTC−12) at the
 * start of the window. A client cannot move its "today" forward to pass an
 * age rule (API-5: S4's minor rule).
 */
export function clientDateInRange(date: string, now: Date): boolean {
  const day = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(day)) return false;
  const latest = Date.parse(new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const oldest = now.getTime() - privacyValue('offlineRecordMaxAgeSeconds') * 1000 - 12 * 3_600_000;
  const earliest = Date.parse(new Date(oldest).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  return day <= latest && day >= earliest;
}

/** True when a local calendar date is the local date of `at` somewhere on Earth (UTC−12 … UTC+14). */
export function dateMatchesInstant(date: string, at: string): boolean {
  const day = Date.parse(`${date}T00:00:00.000Z`);
  const t = Date.parse(at);
  if (Number.isNaN(day) || Number.isNaN(t)) return false;
  return t + 14 * 3_600_000 >= day && t - 12 * 3_600_000 < day + DAY_MS;
}
