import { describe, expect, it } from 'vitest';
import {
  AdherenceStatSchema,
  BODY_INPUT_BOUNDS,
  BodyMetricSchema,
  GuardrailEventSchema,
  MeasurementSchema,
  MilestoneForecastSchema,
  ProgressPhotoSchema,
  WrappedPhotoKeySchema,
  unvalidatedKeys,
} from './index.js';

const at = '2026-09-24T07:00:00.000Z';
const id = '11111111-1111-4111-8111-111111111111';

describe('M04 contracts', () => {
  it('body metrics: weight and body fat within plausible bounds; only a correction removes a value', () => {
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'weight', value: 60.4, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(true);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'body_fat', value: 24, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(true);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'weight', value: 3, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'body_fat', value: 90, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'weight', value: null, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'weight', value: null, measuredOn: '2026-09-24', at, correctionOf: id }).success).toBe(true);
    expect(BodyMetricSchema.safeParse({ schemaVersion: 1, kind: 'weight', value: 60, measuredOn: '2026-02-30', at, correctionOf: null }).success).toBe(false);
  });

  it('measurements: circumferences per site, corrections as for body metrics', () => {
    expect(MeasurementSchema.safeParse({ schemaVersion: 1, site: 'waist', valueCm: 80, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(true);
    expect(MeasurementSchema.safeParse({ schemaVersion: 1, site: 'waist', valueCm: 5, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
    expect(MeasurementSchema.safeParse({ schemaVersion: 1, site: 'ankle', valueCm: 25, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
    expect(MeasurementSchema.safeParse({ schemaVersion: 1, site: 'waist', valueCm: null, measuredOn: '2026-09-24', at, correctionOf: null }).success).toBe(false);
  });

  it('a forecast is always an estimate with a range and a confidence; other statuses have neither', () => {
    const base = { milestoneId: 'ladder.pull:pull_up', estimate: true, points: 8, reasonCodes: ['progress.forecast.linear_trend'] };
    expect(MilestoneForecastSchema.safeParse({ ...base, status: 'forecast', earliest: '2026-11-01', latest: '2027-01-15', confidence: 'medium' }).success).toBe(true);
    expect(MilestoneForecastSchema.safeParse({ ...base, status: 'forecast', earliest: '2027-02-01', latest: '2027-01-15', confidence: 'medium' }).success).toBe(false);
    expect(MilestoneForecastSchema.safeParse({ ...base, status: 'forecast', earliest: '2026-11-01', latest: null, confidence: 'medium' }).success).toBe(false);
    expect(MilestoneForecastSchema.safeParse({ ...base, status: 'insufficient_data', earliest: null, latest: null, confidence: null }).success).toBe(true);
    expect(MilestoneForecastSchema.safeParse({ ...base, status: 'insufficient_data', earliest: '2026-11-01', latest: '2026-12-01', confidence: 'low' }).success).toBe(false);
    expect(MilestoneForecastSchema.safeParse({ ...base, estimate: false, status: 'insufficient_data', earliest: null, latest: null, confidence: null }).success).toBe(false);
  });

  it('photos, wrapped keys, adherence and the guardrail event parse', () => {
    expect(ProgressPhotoSchema.safeParse({ schemaVersion: 1, id, pose: 'front', takenOn: '2026-09-24', at, mimeType: 'image/jpeg', byteLength: 1200, backedUpAt: null }).success).toBe(true);
    expect(WrappedPhotoKeySchema.safeParse({ schemaVersion: 1, kdf: { name: 'scrypt', logN: 15, r: 8, p: 1 }, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', wrappedKey: 'A'.repeat(80) }).success).toBe(true);
    expect(WrappedPhotoKeySchema.safeParse({ schemaVersion: 1, kdf: { name: 'pbkdf2', logN: 15, r: 8, p: 1 }, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', wrappedKey: 'A'.repeat(80) }).success).toBe(false);
    expect(AdherenceStatSchema.safeParse({ from: '2026-09-01', to: '2026-09-24', planned: 10, completed: 8, rate: 0.8, currentStreakDays: 5, longestStreakDays: 9, extra: 1 }).success).toBe(true);
    expect(GuardrailEventSchema.safeParse({ kind: 'bodyweight.sustained_loss', detectedOn: '2026-09-24', weeks: [{ weekEnd: '2026-09-24', percentPerWeek: -1.4 }], thresholdPercentPerWeek: 1, reasonCodes: ['progress.guardrail.sustained_loss'] }).success).toBe(true);
  });

  it('input bounds carry a source and are not validated', () => {
    expect(unvalidatedKeys(BODY_INPUT_BOUNDS)).toHaveLength(Object.keys(BODY_INPUT_BOUNDS).length);
  });
});
