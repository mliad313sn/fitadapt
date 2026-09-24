import { MilestoneForecastSchema, type BodyMetric, type HistoryExercise, type IsoDate, type Measurement, type PerformedSet, type SessionHistoryEntry } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { ENGINE_CONFIGS } from '../config/index.js';
import { addDays } from '../program/dates.js';
import { volumeRange } from '../program/volume.js';
import {
  ANALYTICS_CONFIG,
  ANALYTICS_RULES_VERSION,
  M04_REASON_CODES,
  adherence,
  analyticsValue,
  bestSet,
  bodyMetricSeries,
  e1rmHistory,
  ewmaTrend,
  exerciseHistory,
  forecastLadderMilestone,
  forecastLoadMilestone,
  forecastMilestone,
  guardrailDue,
  isHardSet,
  ladderProgress,
  measurementSeries,
  sessionHardSets,
  sessionWasTrained,
  setE1RM,
  sustainedLossEvent,
  trainedExercises,
  trendOn,
  volumeLoad,
  weeklyHardSets,
  weeklyRate,
  weeklyRates,
  weeklyVolumeLoad,
} from './index.js';

/**
 * Goal condition 1: packages/engine analytics exposes pure functions for e1RM
 * history, volume load, weekly hard sets per muscle, EWMA bodyweight trend,
 * %BW/week rate, adherence and milestone forecasts (a date range and a
 * confidence). Goal condition 2: sustained loss > 1 % BW/week for 3 weeks
 * emits the guardrail event M10 consumes.
 */

const dateOf = (iso: string) => iso.slice(0, 10);
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

const set = (reps: number | null, loadKg: number | null, rir: number | null = 2, status: PerformedSet['status'] = 'done', seconds: number | null = null, index = 1): PerformedSet => ({ index, status, reps, seconds, loadKg, rir });

function exercise(exerciseId: string, performed: PerformedSet[], over: Partial<HistoryExercise> = {}): HistoryExercise {
  return { slot: 'squat', role: 'primary', exerciseId, ladderId: null, target: { kind: 'reps', min: 6, max: 10 }, targetRir: 2, prescribedLoadKg: null, performed, ...over };
}

function session(date: IsoDate, exercises: HistoryExercise[], over: Partial<SessionHistoryEntry> = {}): SessionHistoryEntry {
  const at = `${date}T08:00:00.000Z`;
  return { planId: uuid(), prescribedAt: at, startedAt: at, countsForProgression: true, exercises, ...over };
}

const weight = (date: IsoDate, value: number | null, correctionOf: string | null = null, id = uuid()) => ({ id, data: { schemaVersion: 1, kind: 'weight', value, measuredOn: date, at: `${date}T07:00:00.000Z`, correctionOf } as BodyMetric });

describe('strength: e1RM history, best set, volume load, variant level', () => {
  const history = [
    session('2026-09-01', [exercise('barbell_back_squat', [set(8, 100), set(8, 100, 1, 'done', null, 2), set(null, null, null, 'skipped', null, 3)])]),
    session('2026-09-04', [exercise('barbell_back_squat', [set(6, 110, 2), set(5, 110, 0, 'done', null, 2)]), exercise('push_up', [set(15, null, 2)], { slot: 'horizontal_push' })]),
    session('2026-09-08', [exercise('push_up', [set(20, null, 1)], { slot: 'horizontal_push' })]),
  ];

  it('e1RM of a set is Epley with the reserve (M07), only for done, loaded sets of 1–12 reps', () => {
    expect(setE1RM(set(8, 100, 2))).toBeCloseTo(100 * (1 + 10 / 30), 6);
    expect(setE1RM(set(8, null))).toBeNull();
    expect(setE1RM(set(15, 60))).toBeNull();
    expect(setE1RM(set(8, 100, 2, 'skipped'))).toBeNull();
    expect(setE1RM(set(null, 100, 2, 'done', 30))).toBeNull();
    // An unreported reserve counts as none (the lower, cautious estimate).
    expect(setE1RM(set(8, 100, null))).toBeCloseTo(100 * (1 + 8 / 30), 6);
  });

  it('volume load is Σ reps × load of the done, loaded sets', () => {
    expect(volumeLoad([set(8, 100), set(8, 100), set(8, 100, 2, 'skipped')])).toBe(1600);
    expect(volumeLoad([set(15, null), set(null, null, null, 'done', 30)])).toBe(0);
    expect(volumeLoad([set(3, 33.33)])).toBe(99.99);
  });

  it('best set: highest e1RM; without a load, most reps, then the longest hold, then the fewest reps in reserve', () => {
    expect(bestSet([set(8, 100, 2), set(6, 110, 2, 'done', null, 2)])).toMatchObject({ reps: 6, loadKg: 110 });
    expect(bestSet([set(12, null, 2), set(15, null, 3, 'done', null, 2)])).toMatchObject({ reps: 15 });
    expect(bestSet([set(null, null, 2, 'done', 20), set(null, null, 2, 'done', 30, 2)])).toMatchObject({ seconds: 30 });
    expect(bestSet([set(10, null, 3), set(10, null, 1, 'done', null, 2)])).toMatchObject({ rir: 1 });
    expect(bestSet([set(10, null, 1), set(10, null, 3, 'done', null, 2)])).toMatchObject({ rir: 1, index: 1 });
    expect(bestSet([set(8, 100, 2, 'skipped')])).toBeNull();
    expect(bestSet([set(8, 100, 2), set(10, null, 0, 'done', null, 2)])).toMatchObject({ loadKg: 100 });
    expect(bestSet([set(null, null, 2, 'done', 30), set(10, null, null, 'done', null, 2)])).toMatchObject({ reps: 10 });
    expect(bestSet([set(10, null, null), set(null, null, 2, 'done', 40, 2)])).toMatchObject({ reps: 10 });
  });

  it('per-exercise history: one point per session with done sets, with e1RM, best set, volume load and the ladder rung', () => {
    const points = exerciseHistory(history, 'barbell_back_squat', dateOf);
    expect(points.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-04']);
    // Same load and reps: the set with more reps in reserve has the higher e1RM (Epley with the reserve).
    expect(points[0]).toMatchObject({ doneSets: 2, volumeLoadKg: 1600, bestSet: { reps: 8, loadKg: 100, rir: 2 }, ladderRung: null });
    expect(points[0]!.e1rmKg).toBeCloseTo(133.3, 1);
    expect(points[1]!.e1rmKg).toBeCloseTo(110 * (1 + 8 / 30), 1);
    expect(exerciseHistory(history, 'barbell_back_squat', dateOf, () => null)[0]!.ladderRung).toBeNull();
    const push = exerciseHistory(history, 'push_up', dateOf, (id) => (id === 'push_up' ? { ladderId: 'push', rung: 3 } : null));
    expect(push.map((p) => [p.date, p.e1rmKg, p.volumeLoadKg, p.ladderRung, p.bestSet?.reps])).toEqual([
      ['2026-09-04', null, 0, 3, 15],
      ['2026-09-08', null, 0, 3, 20],
    ]);
    expect(e1rmHistory(history, 'barbell_back_squat', dateOf).map((p) => p.date)).toEqual(['2026-09-01', '2026-09-04']);
    expect(e1rmHistory(history, 'push_up', dateOf)).toEqual([]);
  });

  it('lists trained exercises, most recent first, and weekly volume load (Monday weeks)', () => {
    expect(trainedExercises(history, dateOf)).toEqual([
      { exerciseId: 'push_up', lastDate: '2026-09-08', sessions: 2 },
      { exerciseId: 'barbell_back_squat', lastDate: '2026-09-04', sessions: 2 },
    ]);
    const unordered = [history[2]!, history[0]!, session('2026-09-08', [exercise('lunge', [set(8, 10)])])];
    expect(trainedExercises(unordered, dateOf).map((e) => e.exerciseId)).toEqual(['lunge', 'push_up', 'barbell_back_squat']);
    // Sessions out of order still report the latest date per exercise.
    expect(trainedExercises([history[2]!, history[1]!], dateOf)[0]).toEqual({ exerciseId: 'push_up', lastDate: '2026-09-08', sessions: 2 });
    expect(weeklyVolumeLoad(history, dateOf)).toEqual([
      { weekStart: '2026-08-31', volumeLoadKg: 1600 + 660 + 550, sessions: 2 },
      { weekStart: '2026-09-07', volumeLoadKg: 0, sessions: 1 },
    ]);
    const cardioOnly = session('2026-09-09', [], { cardioSeconds: 600 });
    const nothing = session('2026-09-10', [exercise('push_up', [set(null, null, null, 'skipped')])]);
    expect(weeklyVolumeLoad([cardioOnly, nothing], dateOf)).toEqual([{ weekStart: '2026-09-07', volumeLoadKg: 0, sessions: 1 }]);
    expect(sessionWasTrained(cardioOnly)).toBe(true);
    expect(sessionWasTrained(nothing)).toBe(false);
    expect(sessionWasTrained(history[0]!)).toBe(true);
  });
});

describe('weekly hard sets per muscle against the M08 ranges', () => {
  it('a hard set is a done set with ≤ hardSet.maxRir in reserve (the target when unreported)', () => {
    const ex = { targetRir: 2 };
    expect(isHardSet(set(8, 50, 4), ex)).toBe(true);
    expect(isHardSet(set(8, 50, 5), ex)).toBe(false);
    expect(isHardSet(set(8, 50, null), ex)).toBe(true);
    expect(isHardSet(set(8, 50, null), { targetRir: 5 })).toBe(false);
    expect(isHardSet(set(8, 50, 2, 'skipped'), ex)).toBe(false);
    expect(isHardSet(set(0, 50, 2), ex)).toBe(false);
    expect(isHardSet(set(null, null, 2, 'done', 30), ex)).toBe(true);
  });

  it('counts sets per group with M08 contributions (fractional for secondary muscles), per Monday week, with the range and status', () => {
    const squat = session('2026-09-02', [exercise('goblet_squat', [set(10, 20), set(10, 20, 2, 'done', null, 2), set(10, 20, 6, 'done', null, 3)])]);
    const bench = session('2026-09-03', [exercise('push_up', [set(12, null), set(12, null, 2, 'done', null, 2)], { slot: 'horizontal_push' }), exercise('dead_bug', [set(10, null)], { slot: 'balance' })]);
    const perSession = sessionHardSets(squat);
    expect(perSession.get('quads')).toBe(2);
    expect(perSession.get('glutes_hamstrings')).toBeGreaterThan(0);
    expect(perSession.get('glutes_hamstrings')).toBeLessThan(2);
    const balance = sessionHardSets(session('2026-09-03', [exercise('dead_bug', [set(10, null)], { slot: 'balance' })]));
    expect(balance.size).toBe(0);

    const weeks = weeklyHardSets({ history: [squat, bench, session('2026-08-20', [exercise('goblet_squat', [set(10, 20)])])], dateOf, trainingAge: 'beginner', through: '2026-09-06', weeks: 2 });
    expect(new Set(weeks.map((w) => w.weekStart))).toEqual(new Set(['2026-08-24', '2026-08-31']));
    const range = volumeRange('beginner');
    const quads = weeks.find((w) => w.weekStart === '2026-08-31' && w.muscle === 'quads')!;
    expect(quads).toMatchObject({ hardSets: 2, rangeMin: range.min, rangeMax: range.max, status: 'below' });
    expect(weeks.find((w) => w.weekStart === '2026-08-24' && w.muscle === 'quads')!.hardSets).toBe(0);
    expect(weeks.find((w) => w.weekStart === '2026-08-31' && w.muscle === 'chest')!.hardSets).toBe(2);
    const many = session('2026-09-02', [exercise('goblet_squat', Array.from({ length: 20 }, (_, i) => set(10, 20, 2, 'done', null, i + 1)))]);
    const lots = weeklyHardSets({ history: [many], dateOf, trainingAge: 'beginner', through: '2026-09-02', weeks: 1 });
    expect(lots.find((w) => w.muscle === 'quads')!.status).toBe('above');
    const within = session('2026-09-02', [exercise('goblet_squat', Array.from({ length: range.min }, (_, i) => set(10, 20, 2, 'done', null, i + 1)))]);
    expect(weeklyHardSets({ history: [within], dateOf, trainingAge: 'beginner', through: '2026-09-02', weeks: 0 }).find((w) => w.muscle === 'quads')!.status).toBe('within');
  });
});

describe('bodyweight trend (EWMA) and %BW/week rate', () => {
  it('series keep the entries in force: corrections replace, a null correction removes, one value per day (mean)', () => {
    const a = weight('2026-09-01', 70);
    const b = weight('2026-09-02', 90);
    const records = [a, b, weight('2026-09-02', 70.4, b.id), weight('2026-09-03', 70.2), weight('2026-09-03', 70.6), weight('2026-09-04', null, a.id)];
    expect(bodyMetricSeries(records, 'weight')).toEqual([
      { date: '2026-09-02', value: 70.4 },
      { date: '2026-09-03', value: 70.4 },
    ]);
    const fat = { id: uuid(), data: { schemaVersion: 1, kind: 'body_fat', value: 25, measuredOn: '2026-09-01', at: '2026-09-01T07:00:00.000Z', correctionOf: null } as BodyMetric };
    expect(bodyMetricSeries([...records, fat], 'body_fat')).toEqual([{ date: '2026-09-01', value: 25 }]);
    const waist = (date: IsoDate, valueCm: number | null, correctionOf: string | null = null, id = uuid()) => ({ id, data: { schemaVersion: 1, site: 'waist', valueCm, measuredOn: date, at: `${date}T07:00:00.000Z`, correctionOf } as Measurement });
    const w1 = waist('2026-09-01', 82);
    expect(measurementSeries([w1, waist('2026-09-08', 81), waist('2026-09-08', null, w1.id), { ...waist('2026-09-08', 40), data: { ...waist('2026-09-08', 40).data, site: 'calf' } }], 'waist')).toEqual([{ date: '2026-09-08', value: 81 }]);
    expect(bodyMetricSeries([], 'weight')).toEqual([]);
  });

  it('EWMA follows the entries with gap-aware weights and starts at the first value', () => {
    const trend = ewmaTrend([
      { date: '2026-09-01', value: 80 },
      { date: '2026-09-02', value: 81 },
      { date: '2026-09-12', value: 81 },
    ]);
    const a = analyticsValue('trend.alphaPerDay');
    expect(trend[0]).toEqual({ date: '2026-09-01', value: 80, trend: 80 });
    expect(trend[1]!.trend).toBeCloseTo(80 + a * 1, 3);
    // After 10 days the weight of the new value is 1 − (1 − α)^10.
    expect(trend[2]!.trend).toBeCloseTo(trend[1]!.trend + (1 - (1 - a) ** 10) * (81 - trend[1]!.trend), 3);
    expect(ewmaTrend([{ date: '2026-09-01', value: 80 }, { date: '2026-09-02', value: 90 }], 1).map((p) => p.trend)).toEqual([80, 90]);
    expect(() => ewmaTrend([], 0)).toThrow(RangeError);
    expect(ewmaTrend([])).toEqual([]);
    // Smoother than the raw values: the trend of a noisy flat series stays close to its mean.
    const noisy = Array.from({ length: 60 }, (_, i) => ({ date: addDays('2026-01-01', i), value: 70 + (i % 2 === 0 ? 1 : -1) }));
    const last = ewmaTrend(noisy).at(-1)!.trend;
    expect(Math.abs(last - 70)).toBeLessThan(0.2);
  });

  it('trendOn reads the last point on or before a date', () => {
    const trend = ewmaTrend([{ date: '2026-09-01', value: 80 }, { date: '2026-09-05', value: 80 }]);
    expect(trendOn(trend, '2026-08-31')).toBeNull();
    expect(trendOn(trend, '2026-09-03')).toBe(80);
    expect(trendOn(trend, '2026-09-30')).toBe(80);
  });

  it('rate: change of the trend over 7 days in % of the trend a week earlier; null without enough weigh-ins', () => {
    const daily = (from: IsoDate, days: number, start: number, perDay: number) => Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), value: start + perDay * i }));
    const trend = ewmaTrend(daily('2026-06-01', 120, 80, -0.08), 1);
    const r = weeklyRate(trend, '2026-09-01')!;
    // α = 1: the trend is the data, so the rate is exactly the data's: 7 × 0.08 kg over the week-earlier weight.
    const before = 80 - 0.08 * 85;
    expect(r.percentPerWeek).toBeCloseTo((-0.56 / before) * 100, 1);
    const sparse = ewmaTrend([{ date: '2026-09-01', value: 80 }, { date: '2026-09-08', value: 79 }]);
    expect(weeklyRate(sparse, '2026-09-08')).toBeNull();
    const noBefore = ewmaTrend([{ date: '2026-09-05', value: 80 }, { date: '2026-09-06', value: 79 }]);
    expect(weeklyRate(noBefore, '2026-09-08')).toBeNull();
    expect(weeklyRates(trend, '2026-09-01', 3).map((x) => x?.weekEnd)).toEqual(['2026-08-18', '2026-08-25', '2026-09-01']);
    expect(weeklyRates(trend, '2026-09-01', 0)).toHaveLength(1);
  });
});

describe('sustained-loss guardrail (goal condition 2): > 1 % BW/week for 3 weeks emits the event M10 consumes', () => {
  const daily = (from: IsoDate, days: number, start: number, percentPerWeek: number) =>
    Array.from({ length: days }, (_, i) => ({ date: addDays(from, i), value: Math.round(start * (1 + percentPerWeek / 100) ** (i / 7) * 100) / 100 }));

  it('emits the event after three consecutive weeks each losing more than 1 %', () => {
    const series = [...daily('2026-06-01', 60, 90, 0), ...daily('2026-07-31', 42, 90, -1.6)];
    const trend = ewmaTrend(series);
    const today = series.at(-1)!.date;
    const event = sustainedLossEvent(trend, today);
    expect(event).not.toBeNull();
    expect(event).toMatchObject({ kind: 'bodyweight.sustained_loss', detectedOn: today, thresholdPercentPerWeek: 1, reasonCodes: ['progress.guardrail.sustained_loss'] });
    expect(event!.weeks).toHaveLength(3);
    for (const w of event!.weeks) expect(w.percentPerWeek).toBeLessThan(-1);
  });

  it('emits nothing for a loss ≤ 1 %/week, for only two weeks of fast loss, for a gain, or with a week missing data', () => {
    const slow = ewmaTrend([...daily('2026-06-01', 60, 90, 0), ...daily('2026-07-31', 42, 90, -0.8)]);
    expect(sustainedLossEvent(slow, '2026-09-10')).toBeNull();
    const twoWeeks = [...daily('2026-06-01', 60, 90, 0), ...daily('2026-07-31', 42, 90, -1.6)].slice(0, 60 + 10);
    expect(sustainedLossEvent(ewmaTrend(twoWeeks), twoWeeks.at(-1)!.date)).toBeNull();
    const gain = ewmaTrend([...daily('2026-06-01', 60, 60, 0), ...daily('2026-07-31', 42, 60, 1.5)]);
    expect(sustainedLossEvent(gain, '2026-09-10')).toBeNull();
    const fast = [...daily('2026-06-01', 60, 90, 0), ...daily('2026-07-31', 42, 90, -1.6)];
    const gap = fast.filter((p) => !(p.date > '2026-08-27' && p.date <= '2026-09-03'));
    expect(sustainedLossEvent(ewmaTrend(gap), '2026-09-10')).toBeNull();
    expect(sustainedLossEvent([], '2026-09-10')).toBeNull();
  });

  it('a new notice is due for an event when none was handed off within the repeat interval', () => {
    const event = sustainedLossEvent(ewmaTrend([...daily('2026-06-01', 60, 90, 0), ...daily('2026-07-31', 42, 90, -1.6)]), '2026-09-10');
    expect(guardrailDue(event, null)).toBe(true);
    expect(guardrailDue(event, '2026-09-05')).toBe(false);
    expect(guardrailDue(event, addDays('2026-09-10', -analyticsValue('guardrail.repeatAfterDays')))).toBe(true);
    expect(guardrailDue(null, null)).toBe(false);
  });
});

describe('adherence: planned vs completed, streaks that count planned rest days', () => {
  it('counts planned and kept sessions, extra sessions, and a streak that rest days continue', () => {
    const stat = adherence({ planned: ['2026-09-01', '2026-09-03', '2026-09-05'], trained: ['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05'], from: '2026-09-01', to: '2026-09-07' });
    expect(stat).toMatchObject({ planned: 3, completed: 3, rate: 1, extra: 1, currentStreakDays: 7, longestStreakDays: 7 });
  });

  it('only a planned session that did not happen ends the streak; today is still in progress', () => {
    const stat = adherence({ planned: ['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-08'], trained: ['2026-09-01', '2026-09-05'], from: '2026-09-01', to: '2026-09-08' });
    // 01 kept, 02 rest, 03 missed (ends it), 04 rest, 05 kept, 06–07 rest, 08 today still to do: 4 days.
    expect(stat).toMatchObject({ planned: 4, completed: 2, rate: 0.5, currentStreakDays: 4, longestStreakDays: 4 });
    const doneToday = adherence({ planned: ['2026-09-08'], trained: ['2026-09-08'], from: '2026-09-07', to: '2026-09-08' });
    expect(doneToday.currentStreakDays).toBe(2);
  });

  it('two sessions planned on one day need both; without a plan there is no rate and no streak', () => {
    expect(adherence({ planned: ['2026-09-01', '2026-09-01'], trained: ['2026-09-01'], from: '2026-09-01', to: '2026-09-02' })).toMatchObject({ planned: 2, completed: 1, currentStreakDays: 1, longestStreakDays: 1 });
    expect(adherence({ planned: [], trained: ['2026-09-01'], from: '2026-09-01', to: '2026-09-07' })).toMatchObject({ planned: 0, rate: null, currentStreakDays: 0, longestStreakDays: 0, extra: 1 });
    expect(adherence({ planned: ['2026-08-01'], trained: [], from: '2026-09-01', to: '2026-09-02' }).planned).toBe(0);
    expect(() => adherence({ planned: [], trained: [], from: '2026-09-02', to: '2026-09-01' })).toThrow(RangeError);
  });
});

describe('milestone forecasts: a date range with a confidence, always an estimate', () => {
  const today = '2026-09-24';
  const line = (days: number, every: number, start: number, perDay: number, noise = 0) =>
    Array.from({ length: Math.floor(days / every) }, (_, i) => ({ date: addDays(today, -days + i * every + every), value: start + perDay * i * every + (i % 2 === 0 ? noise : -noise) }));

  it('a steady trend gives a range around the date the line reaches the target, earliest ≤ latest, high confidence on clean data', () => {
    const f = forecastMilestone({ milestoneId: 'e1rm.squat:120', points: line(84, 3, 90, 0.2), target: 120, today, achieved: false });
    expect(MilestoneForecastSchema.parse(f)).toEqual(f);
    expect(f.status).toBe('forecast');
    expect(f.estimate).toBe(true);
    expect(f.confidence).toBe('high');
    // 90 + 0.2 × 81 ≈ 106.2 today → 13.8 kg to go at 0.2 kg/day ≈ 69 days.
    expect(f.earliest! <= addDays(today, 69)).toBe(true);
    expect(f.latest! >= addDays(today, 69)).toBe(true);
    expect(f.reasonCodes).toEqual(['progress.forecast.linear_trend', 'progress.forecast.confidence.high', 'progress.forecast.estimate_only']);
  });

  it('noisier or shorter data lowers the confidence and widens the range', () => {
    const clean = forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.2), target: 120, today, achieved: false });
    const noisy = forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.2, 4), target: 120, today, achieved: false });
    const few = forecastMilestone({ milestoneId: 'm', points: line(28, 7, 100, 0.2, 0.3), target: 120, today, achieved: false });
    expect(noisy.status).toBe('forecast');
    expect(['low', 'medium']).toContain(noisy.confidence);
    const width = (f: typeof clean) => new Date(f.latest!).getTime() - new Date(f.earliest!).getTime();
    expect(width(noisy)).toBeGreaterThan(width(clean));
    expect(few.status).toBe('forecast');
    expect(few.confidence).toBe('low');
    const medium = forecastMilestone({ milestoneId: 'm', points: line(56, 7, 90, 0.2, 0.4), target: 120, today, achieved: false });
    expect(medium.confidence).toBe('medium');
  });

  it('never a single day: the range is at least forecast.minRangeDays wide', () => {
    const f = forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.2), target: 106.5, today, achieved: false });
    expect(f.status).toBe('forecast');
    const days = (new Date(f.latest!).getTime() - new Date(f.earliest!).getTime()) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(analyticsValue('forecast.minRangeDays'));
    const past = forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.2), target: 100, today, achieved: false });
    expect(past.status).toBe('forecast');
    expect(past.earliest).toBe(addDays(today, 1));
  });

  it('no forecast without enough data, without an upward trend, beyond the horizon; achieved says so', () => {
    expect(forecastMilestone({ milestoneId: 'm', points: line(84, 30, 90, 0.2), target: 120, today, achieved: false }).status).toBe('insufficient_data');
    expect(forecastMilestone({ milestoneId: 'm', points: line(14, 2, 90, 0.2), target: 120, today, achieved: false }).status).toBe('insufficient_data');
    expect(forecastMilestone({ milestoneId: 'm', points: [], target: 120, today, achieved: false }).status).toBe('insufficient_data');
    expect(forecastMilestone({ milestoneId: 'm', points: line(84, 3, 110, -0.05), target: 120, today, achieved: false }).status).toBe('no_trend');
    expect(forecastMilestone({ milestoneId: 'm', points: line(84, 3, 100, 0), target: 120, today, achieved: false }).status).toBe('no_trend');
    expect(forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.01), target: 200, today, achieved: false }).status).toBe('beyond_horizon');
    const achieved = forecastMilestone({ milestoneId: 'm', points: line(84, 3, 90, 0.2), target: 100, today, achieved: true });
    expect(achieved).toMatchObject({ status: 'achieved', earliest: null, latest: null, confidence: null, reasonCodes: ['progress.forecast.achieved', 'progress.forecast.estimate_only'] });
    // Points outside the window, in the future or not finite are ignored.
    const odd = [...line(84, 3, 90, 0.2), { date: addDays(today, 5), value: 500 }, { date: '2025-01-01', value: 0 }, { date: today, value: Number.NaN }];
    expect(forecastMilestone({ milestoneId: 'm', points: odd, target: 120, today, achieved: false }).points).toBe(28);
  });

  it('a wide slope uncertainty caps the latest date at the horizon with low confidence', () => {
    const wild = Array.from({ length: 6 }, (_, i) => ({ date: addDays(today, -80 + i * 15), value: 90 + i * 1.5 + (i % 2 === 0 ? 6 : -6) }));
    const f = forecastMilestone({ milestoneId: 'm', points: wild, target: 110, today, achieved: false });
    if (f.status === 'forecast') {
      expect(f.latest! <= addDays(today, analyticsValue('forecast.horizonDays'))).toBe(true);
      expect(f.confidence).toBe('low');
    } else {
      expect(['no_trend', 'beyond_horizon']).toContain(f.status);
    }
  });

  describe('P2 (Awa): first strict pull-up on the pull ladder', () => {
    const steps = [['dead_hang'], ['scapular_pull_up'], ['inverted_row_incline'], ['inverted_row'], ['band_assisted_pull_up'], ['negative_pull_up'], ['pull_up'], ['weighted_pull_up']];
    const pull = (exerciseId: string, reps: number[]) => exercise(exerciseId, reps.map((r, i) => set(r, null, 2, 'done', null, i + 1)), { slot: 'vertical_pull', ladderId: 'pull', target: { kind: 'reps', min: 3, max: 8 } });
    const weeks: SessionHistoryEntry[] = [];
    // Three sessions a week over ten weeks: band-assisted reps climb, then negatives appear.
    for (let w = 0; w < 10; w += 1) {
      for (const d of [0, 2, 4]) {
        const date = addDays('2026-07-13', w * 7 + d);
        weeks.push(session(date, [w < 6 ? pull('band_assisted_pull_up', [3 + Math.floor(w / 1.5), 3 + Math.floor(w / 2)]) : pull('negative_pull_up', [2 + (w - 6), 2 + (w - 6)])]));
      }
    }
    const milestone = { ladderId: 'pull', steps, targetExerciseId: 'pull_up' };

    it('ladder progress is the rung plus the share of the top reps', () => {
      const points = ladderProgress(weeks, steps, dateOf);
      expect(points[0]!.value).toBeCloseTo(4 + 3 / 8, 3);
      expect(points.at(-1)!.value).toBeGreaterThan(5);
      expect(points.every((p) => p.value < 6)).toBe(true);
      const hold = session('2026-07-01', [exercise('dead_hang', [set(null, null, 2, 'done', 20)], { target: { kind: 'hold', seconds: 30 } }), exercise('dead_hang', [set(null, null, 2, 'skipped', 20), set(null, null, 2, 'done', 0, 2)], { target: { kind: 'hold', seconds: 30 } })]);
      expect(ladderProgress([hold, session('2026-07-02', [exercise('goblet_squat', [set(8, 10)])])], steps, dateOf)).toEqual([{ date: '2026-07-01', value: 0.667 }]);
      const noCount = session('2026-07-03', [exercise('dead_hang', [set(null, null, 2, 'done', null)], { target: { kind: 'hold', seconds: 30 } }), exercise('pull_up', [set(null, null, 2)], { target: { kind: 'reps', min: 1, max: 5 } })]);
      expect(ladderProgress([noCount], steps, dateOf)).toEqual([]);
    });

    it('forecasts a date range with a confidence while the pull-up is not reached', () => {
      const f = forecastLadderMilestone(weeks, milestone, dateOf, '2026-09-20');
      expect(f).toMatchObject({ milestoneId: 'ladder.pull:pull_up', status: 'forecast', estimate: true });
      expect(f.earliest! > '2026-09-20').toBe(true);
      expect(f.latest! >= f.earliest!).toBe(true);
      expect(f.confidence).not.toBeNull();
    });

    it('once a strict pull-up set is done, the milestone is achieved (no forecast)', () => {
      const done = [...weeks, session('2026-09-22', [pull('pull_up', [1])])];
      expect(forecastLadderMilestone(done, milestone, dateOf, '2026-09-24').status).toBe('achieved');
      expect(() => forecastLadderMilestone(weeks, { ...milestone, targetExerciseId: 'goblet_squat' }, dateOf, '2026-09-24')).toThrow(RangeError);
    });
  });

  it('load milestone: forecast on the best e1RM per session', () => {
    const history = Array.from({ length: 20 }, (_, i) => session(addDays('2026-07-10', i * 4), [exercise('barbell_back_squat', [set(5, 80 + i, 2)])]));
    const f = forecastLoadMilestone(history, 'barbell_back_squat', 140, dateOf, '2026-09-24');
    expect(f.milestoneId).toBe('e1rm.barbell_back_squat:140');
    expect(f.status).toBe('forecast');
    expect(forecastLoadMilestone(history, 'barbell_back_squat', 100, dateOf, '2026-09-24').status).toBe('achieved');
    expect(forecastLoadMilestone(history, 'push_up', 100, dateOf, '2026-09-24').status).toBe('insufficient_data');
  });
});

describe('M04 config and reason codes', () => {
  it('is listed in ENGINE_CONFIGS; every value has a source and is validated:false', () => {
    expect(ENGINE_CONFIGS.analytics).toBe(ANALYTICS_CONFIG);
    for (const [key, v] of Object.entries(ANALYTICS_CONFIG)) {
      expect(v.validated, key).toBe(false);
      expect(v.source.length, key).toBeGreaterThan(20);
    }
    expect(ANALYTICS_CONFIG['guardrail.lossPercentPerWeek'].source).toContain('docs/specs/M04');
    expect(ANALYTICS_CONFIG['guardrail.consecutiveWeeks'].source).toContain('docs/specs/M04');
    // The observed-loss guardrail never tolerates more than the S4 planned-loss ceiling (1 %/week).
    expect(analyticsValue('guardrail.lossPercentPerWeek')).toBeLessThanOrEqual(1);
    expect(ANALYTICS_RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reason codes are unique dotted codes', () => {
    expect(new Set(M04_REASON_CODES).size).toBe(M04_REASON_CODES.length);
    for (const c of M04_REASON_CODES) expect(c).toMatch(/^progress\.[a-z_.]+$/);
  });
});
