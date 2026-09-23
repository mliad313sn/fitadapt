import type { AnalyticsEvent } from '@fitadapt/privacy';

/**
 * Where accepted analytics events go. The pipeline (storage, dashboards) is
 * M18. Events reaching a sink are allowlisted and carry no user id.
 */
export interface AnalyticsSink {
  accept(events: readonly AnalyticsEvent[]): Promise<void>;
}

export class NoopAnalyticsSink implements AnalyticsSink {
  async accept(): Promise<void> {}
}

export class MemoryAnalyticsSink implements AnalyticsSink {
  readonly events: AnalyticsEvent[] = [];
  async accept(events: readonly AnalyticsEvent[]): Promise<void> {
    this.events.push(...events);
  }
}
