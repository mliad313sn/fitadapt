import { CONSENT_DATA_TYPES, LocaleSchema } from '@fitadapt/shared';
import { z } from 'zod';
import { findPersonalData, type PersonalDataFinding } from './scrubber.js';

/**
 * Analytics event allowlist (M17 baseline; M18 adds events through this same
 * registry). Events carry no user id, no free strings and no measurements:
 * every property is an enum, a boolean or a small bucketed count. Unknown
 * events and unknown properties are rejected, not stripped, so a mistake shows
 * up in tests instead of silently shipping. Sending any event also requires
 * the `analytics` consent (feature `analytics.product`).
 */
const bucket = z.enum(['0', '1', '2-5', '6-20', '21+']);

export const ANALYTICS_EVENTS = {
  app_opened: z.strictObject({}),
  screen_viewed: z.strictObject({ screen: z.enum(['home', 'privacy', 'age_gate', 'progress', 'photos']) }),
  language_changed: z.strictObject({ locale: LocaleSchema }),
  units_changed: z.strictObject({ unitSystem: z.enum(['metric', 'imperial']) }),
  gym_mode_toggled: z.strictObject({ enabled: z.boolean() }),
  consent_changed: z.strictObject({ dataType: z.enum(CONSENT_DATA_TYPES), decision: z.enum(['granted', 'withdrawn']) }),
  data_export_requested: z.strictObject({}),
  account_deletion_requested: z.strictObject({}),
  sync_completed: z.strictObject({ pushed: bucket, pulled: bucket }),
  // M04 KPIs (export usage, photo backup opt-in): the format and a yes/no only — never a body value, a date or a count of photos.
  progress_export_requested: z.strictObject({ format: z.enum(['json', 'csv']), withPhotos: z.boolean() }),
  photo_backup_toggled: z.strictObject({ enabled: z.boolean() }),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENTS;
export type AnalyticsProps<E extends AnalyticsEventName> = z.infer<(typeof ANALYTICS_EVENTS)[E]>;

export interface AnalyticsEvent<E extends AnalyticsEventName = AnalyticsEventName> {
  readonly event: E;
  readonly props: AnalyticsProps<E>;
}

export const AnalyticsEventInputSchema = z.strictObject({
  event: z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()).default({}),
});

export const AnalyticsBatchSchema = z.strictObject({ events: z.array(AnalyticsEventInputSchema).min(1).max(50) });

export type AnalyticsRejection =
  | { readonly ok: false; readonly reason: 'unknown_event' }
  | { readonly ok: false; readonly reason: 'invalid_props' }
  | { readonly ok: false; readonly reason: 'personal_data'; readonly findings: readonly PersonalDataFinding[] };

export type AnalyticsValidation = { readonly ok: true; readonly event: AnalyticsEvent } | AnalyticsRejection;

export function isAnalyticsEventName(name: string): name is AnalyticsEventName {
  return Object.prototype.hasOwnProperty.call(ANALYTICS_EVENTS, name);
}

/** Validates one event against the allowlist, then scans it for personal data as a second line of defence. */
export function validateAnalyticsEvent(input: { event: string; props?: Record<string, unknown> }): AnalyticsValidation {
  if (!isAnalyticsEventName(input.event)) return { ok: false, reason: 'unknown_event' };
  const findings = findPersonalData(input);
  if (findings.length > 0) return { ok: false, reason: 'personal_data', findings };
  const parsed = ANALYTICS_EVENTS[input.event].safeParse(input.props ?? {});
  if (!parsed.success) return { ok: false, reason: 'invalid_props' };
  return { ok: true, event: { event: input.event, props: parsed.data } as AnalyticsEvent };
}

/** Maps a count to the bucket used in events (no exact counts leave the device). */
export function countBucket(n: number): z.infer<typeof bucket> {
  if (n <= 0) return '0';
  if (n === 1) return '1';
  if (n <= 5) return '2-5';
  if (n <= 20) return '6-20';
  return '21+';
}
