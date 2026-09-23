import { ApiError } from '../auth/errors.js';
import { privacyValue } from '../config/privacy.config.js';

/**
 * Time a record was made on the device (M01, ADR-013). Decisions taken offline
 * are uploaded later with their device time; the server keeps its own receipt
 * time beside it. A device time in the future (beyond clock skew) or older
 * than the offline window is refused, so a client cannot backdate at will.
 */
export function clientTime(at: string | undefined, now: Date, code: string): Date {
  if (at === undefined) return now;
  const t = Date.parse(at);
  const skew = privacyValue('clientClockSkewSeconds') * 1000;
  const window = privacyValue('offlineRecordMaxAgeSeconds') * 1000;
  if (Number.isNaN(t) || t > now.getTime() + skew || t < now.getTime() - window) throw new ApiError(400, code);
  return new Date(Math.min(t, now.getTime()));
}
