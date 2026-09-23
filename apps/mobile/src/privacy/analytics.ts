import { validateAnalyticsEvent, type AnalyticsEvent, type AnalyticsEventName, type AnalyticsProps } from '@fitadapt/privacy';

export interface AnalyticsTransport {
  send(event: AnalyticsEvent): void;
}

export type TrackResult = 'sent' | 'dropped_no_consent' | 'rejected';

/**
 * Product analytics on the device. Nothing is sent without the `analytics`
 * consent, and every event must pass the allowlist and the personal-data check
 * (ADR-007). The transport (batching, upload) is M18; the default drops events.
 */
export function createAnalytics(deps: { isEnabled: () => boolean; transport?: AnalyticsTransport }) {
  const transport = deps.transport ?? { send: () => undefined };
  return {
    track<E extends AnalyticsEventName>(event: E, props?: AnalyticsProps<E>): TrackResult {
      if (!deps.isEnabled()) return 'dropped_no_consent';
      const result = validateAnalyticsEvent({ event, props: props as Record<string, unknown> | undefined });
      if (!result.ok) return 'rejected';
      transport.send(result.event);
      return 'sent';
    },
  };
}

export type Analytics = ReturnType<typeof createAnalytics>;
