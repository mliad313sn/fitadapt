import { describe, expect, it } from 'vitest';
import { CARDIO_INPUT_BOUNDS, CARDIO_INPUT_BOUNDS_CONFIG, CardioPlanSchema, CardioRequestSchema, HeartRateInfoSchema, type CardioPlan } from './cardio.js';
import { ExecutionLogSchema } from './session.js';

const seg = (index: number, startSeconds: number, durationSeconds: number, intensity: 'light' | 'moderate' | 'vigorous', kind: CardioPlan['timeline'][number]['kind'] = 'work') => ({ index, kind, startSeconds, durationSeconds, intensity, exerciseId: null, reps: null, round: null, rounds: null });
const zones = { method: 'perceived_exertion' as const, hrMaxBpm: null, restingBpm: null, zones: (['light', 'moderate', 'vigorous'] as const).map((intensity) => ({ intensity, minBpm: null, maxBpm: null, rpeMin: 2, rpeMax: 3, talkTest: 'full_conversation' as const })), reasonCodes: ['cardio.zones.perceived_exertion'] };
const plan = (over: Partial<CardioPlan> = {}): CardioPlan => ({
  protocol: 'hiit',
  placement: 'finisher',
  hiit: true,
  interval: { workSeconds: 30, restSeconds: 60, rounds: 1, blocks: 1, blockRestSeconds: 0 },
  impactCeiling: 'low',
  movements: [],
  targetIntensity: 'vigorous',
  zones,
  timeline: [seg(0, 0, 30, 'vigorous'), seg(1, 30, 60, 'light', 'recover')],
  totalSeconds: 90,
  planned: { moderateSeconds: 0, vigorousSeconds: 30 },
  reasonCodes: ['cardio.protocol.hiit'],
  ...over,
});

describe('M03 cardio contracts', () => {
  it('a cardio plan is a contiguous timeline that ends at totalSeconds; only a HIIT plan has vigorous work, and it must have some', () => {
    expect(CardioPlanSchema.safeParse(plan()).success).toBe(true);
    expect(CardioPlanSchema.safeParse(plan({ totalSeconds: 91 })).success).toBe(false);
    expect(CardioPlanSchema.safeParse(plan({ timeline: [seg(0, 0, 30, 'vigorous'), seg(1, 31, 59, 'light', 'recover')] })).success).toBe(false);
    expect(CardioPlanSchema.safeParse(plan({ timeline: [seg(1, 0, 30, 'vigorous'), seg(0, 30, 60, 'light', 'recover')] })).success).toBe(false);
    expect(CardioPlanSchema.safeParse(plan({ timeline: [seg(0, 0, 90, 'moderate', 'steady')] })).success).toBe(false);
    expect(CardioPlanSchema.safeParse(plan({ hiit: false })).success).toBe(false);
    expect(CardioPlanSchema.safeParse(plan({ hiit: false, protocol: 'steady', timeline: [seg(0, 0, 90, 'moderate', 'steady')] })).success).toBe(true);
  });

  it('heart-rate facts, custom intervals and cardio logs are bounded (typing errors, not norms)', () => {
    expect(HeartRateInfoSchema.safeParse({ source: 'manual', restingBpm: 58 }).success).toBe(true);
    expect(HeartRateInfoSchema.safeParse({ source: 'manual', restingBpm: 20 }).success).toBe(false);
    expect(CardioRequestSchema.safeParse({ protocol: 'custom', custom: { workSeconds: 5, restSeconds: 10, rounds: 3, intensity: 'moderate' } }).success).toBe(false);
    expect(CardioRequestSchema.safeParse({ protocol: 'custom', custom: { workSeconds: 40, restSeconds: 20, rounds: 8, intensity: 'vigorous' } }).success).toBe(true);
    for (const v of Object.values(CARDIO_INPUT_BOUNDS_CONFIG)) expect(v.validated).toBe(false);
    expect(CARDIO_INPUT_BOUNDS.restingBpmMax).toBe(120);
    const log = { kind: 'cardio_done', planId: '00000000-0000-4000-8000-000000000001', protocol: 'tabata', moderateSeconds: 0, vigorousSeconds: 160, completedWork: 8, totalWork: 8, rounds: null, endedEarly: false, at: '2026-10-05T07:30:00.000Z' };
    expect(ExecutionLogSchema.safeParse(log).success).toBe(true);
    expect(ExecutionLogSchema.safeParse({ ...log, vigorousSeconds: -1 }).success).toBe(false);
  });
});
