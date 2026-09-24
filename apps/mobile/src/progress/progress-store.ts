import { BodyMetricSchema, MeasurementSchema, PROGRESS_COLLECTIONS, type BodyMetric, type BodyMetricKind, type GuardrailEvent, type IsoDate, type Measurement, type MeasurementSite } from '@fitadapt/shared';
import type { SyncClient } from '@fitadapt/sync';
import { createStore } from 'zustand';
import type { NutritionGuardrailPort } from '../nutrition/guardrail-port';
import type { KeyValueStore } from '../storage/app-state';

/**
 * M04 body data on the device (local-first, ADR-002): body weight, the
 * optional body-fat estimate and circumferences are append-only sync records
 * (health data: stored in the encrypted database, synced only with the
 * health consent, erased on the server when it is withdrawn). Showing body
 * weight is the user's choice (kept on the device). The sustained-loss
 * guardrail hand-off to M10 is remembered so the notice is not repeated
 * every day.
 */
export interface StoredBodyMetric {
  readonly id: string;
  readonly data: BodyMetric;
}

export interface StoredMeasurement {
  readonly id: string;
  readonly data: Measurement;
}

const SHOW_WEIGHT_KEY = 'progress_show_body_weight';
const HANDED_OFF_KEY = 'progress_guardrail_handed_off_on';
const BACKUP_KEY = 'progress_photo_backup_enabled';

export interface ProgressStoreDeps {
  readonly sync: SyncClient;
  readonly kv: KeyValueStore;
  readonly now: () => Date;
  readonly nutrition: NutritionGuardrailPort;
  readonly onWrite?: () => void;
}

export interface ProgressState {
  bodyMetrics: StoredBodyMetric[];
  measurements: StoredMeasurement[];
  showBodyWeight: boolean;
  guardrailHandedOffOn: IsoDate | null;
  photoBackupEnabled: boolean;
  reload(): void;
  logBodyMetric(kind: BodyMetricKind, value: number, measuredOn: IsoDate): BodyMetric;
  /** Corrects (or, with null, removes) an entry: a new entry naming the one it corrects. */
  correctBodyMetric(id: string, value: number | null, measuredOn: IsoDate): BodyMetric;
  logMeasurement(site: MeasurementSite, valueCm: number, measuredOn: IsoDate): Measurement;
  setShowBodyWeight(show: boolean): void;
  setPhotoBackupEnabled(enabled: boolean): void;
  /** Shows the supportive notice once and hands the event to M10's guardrails. */
  handOffGuardrail(event: GuardrailEvent): void;
  /** Imports records from an export (idempotent: records already on the device are skipped). */
  importRecords(bodyMetrics: readonly StoredBodyMetric[], measurements: readonly StoredMeasurement[]): number;
}

export function createProgressStore({ sync, kv, now, nutrition, onWrite }: ProgressStoreDeps) {
  const read = () => ({
    bodyMetrics: sync
      .list(PROGRESS_COLLECTIONS.bodyMetrics)
      .flatMap((r) => {
        const p = BodyMetricSchema.safeParse(r.data);
        return p.success ? [{ id: r.id, data: p.data }] : [];
      })
      .sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
    measurements: sync
      .list(PROGRESS_COLLECTIONS.measurements)
      .flatMap((r) => {
        const p = MeasurementSchema.safeParse(r.data);
        return p.success ? [{ id: r.id, data: p.data }] : [];
      })
      .sort((a, b) => a.data.at.localeCompare(b.data.at) || a.id.localeCompare(b.id)),
  });
  return createStore<ProgressState>((set, get) => {
    const written = () => {
      set(read());
      onWrite?.();
    };
    return {
      ...read(),
      showBodyWeight: kv.get(SHOW_WEIGHT_KEY) !== 'false',
      guardrailHandedOffOn: kv.get(HANDED_OFF_KEY) ?? null,
      photoBackupEnabled: kv.get(BACKUP_KEY) === 'true',
      reload: () => set(read()),
      logBodyMetric(kind, value, measuredOn) {
        const data = BodyMetricSchema.parse({ schemaVersion: 1, kind, value, measuredOn, at: now().toISOString(), correctionOf: null });
        sync.insert(PROGRESS_COLLECTIONS.bodyMetrics, data);
        written();
        return data;
      },
      correctBodyMetric(id, value, measuredOn) {
        const original = get().bodyMetrics.find((m) => m.id === id);
        if (!original) throw new Error('unknown body metric');
        const data = BodyMetricSchema.parse({ schemaVersion: 1, kind: original.data.kind, value, measuredOn, at: now().toISOString(), correctionOf: id });
        sync.insert(PROGRESS_COLLECTIONS.bodyMetrics, data);
        written();
        return data;
      },
      logMeasurement(site, valueCm, measuredOn) {
        const data = MeasurementSchema.parse({ schemaVersion: 1, site, valueCm, measuredOn, at: now().toISOString(), correctionOf: null });
        sync.insert(PROGRESS_COLLECTIONS.measurements, data);
        written();
        return data;
      },
      setShowBodyWeight(show) {
        kv.set(SHOW_WEIGHT_KEY, show ? 'true' : 'false');
        set({ showBodyWeight: show });
      },
      setPhotoBackupEnabled(enabled) {
        kv.set(BACKUP_KEY, enabled ? 'true' : 'false');
        set({ photoBackupEnabled: enabled });
      },
      handOffGuardrail(event) {
        nutrition.receive(event);
        kv.set(HANDED_OFF_KEY, event.detectedOn);
        set({ guardrailHandedOffOn: event.detectedOn });
      },
      importRecords(bodyMetrics, measurements) {
        let count = 0;
        for (const r of bodyMetrics) {
          if (sync.get(PROGRESS_COLLECTIONS.bodyMetrics, r.id)) continue;
          sync.insert(PROGRESS_COLLECTIONS.bodyMetrics, BodyMetricSchema.parse(r.data), r.id);
          count += 1;
        }
        for (const r of measurements) {
          if (sync.get(PROGRESS_COLLECTIONS.measurements, r.id)) continue;
          sync.insert(PROGRESS_COLLECTIONS.measurements, MeasurementSchema.parse(r.data), r.id);
          count += 1;
        }
        if (count > 0) written();
        return count;
      },
    };
  });
}

export type ProgressStore = ReturnType<typeof createProgressStore>;
