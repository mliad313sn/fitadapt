import type { CalendarDateValue, CardioIntensity, HeartRateInfo, HrZone, HrZoneSet, SafetyProfile, TalkTest } from '@fitadapt/shared';
import { cardioValue, type CardioConfigKey } from './config.js';

/**
 * M03 effort zones (Claire: heart-rate reserve when a heart-rate source
 * exists, perceived exertion and the talk test otherwise).
 *
 * - HRmax is estimated as 208 − 0.7 × age (Tanaka et al. 2001, as cited by the spec).
 * - With a known resting heart rate and age, each zone is a band of the
 *   heart-rate reserve (Karvonen): resting + fraction × (HRmax − resting).
 * - Without them (or with an implausibly small reserve), zones are given by
 *   perceived exertion (0–10) and the talk test only.
 * Every zone also carries its perceived-exertion range and talk test, capped
 * by the SafetyProfile (S1: never above maxRPE). Zones are named by effort
 * only (C9: no "fat-burning zone").
 */

const TALK: Record<CardioIntensity, TalkTest> = { light: 'full_conversation', moderate: 'short_sentences', vigorous: 'few_words' };
const INTENSITIES: readonly CardioIntensity[] = ['light', 'moderate', 'vigorous'];

/** Whole years of age on a date (null without a date of birth): the user's local date when known (SAF-12), else the UTC date of `nowMs`. */
export function ageOn(birthDate: CalendarDateValue | null | undefined, nowMs: number, localDate?: CalendarDateValue | null): number | null {
  if (!birthDate) return null;
  const now = new Date(nowMs);
  const y = localDate ? localDate.year : now.getUTCFullYear();
  const m = localDate ? localDate.month : now.getUTCMonth() + 1;
  const d = localDate ? localDate.day : now.getUTCDate();
  let age = y - birthDate.year;
  if (m < birthDate.month || (m === birthDate.month && d < birthDate.day)) age -= 1;
  return age;
}

/** Estimated maximum heart rate: 208 − 0.7 × age (Tanaka et al. 2001), rounded to a whole beat. */
export function estimatedHrMax(age: number): number {
  return Math.round(cardioValue('hrMax.intercept') - cardioValue('hrMax.agePerYear') * age);
}

/** Karvonen: a heart rate at a fraction of the heart-rate reserve. */
export function karvonenBpm(restingBpm: number, hrMaxBpm: number, fraction: number): number {
  return Math.round(restingBpm + fraction * (hrMaxBpm - restingBpm));
}

export function rpeRange(intensity: CardioIntensity, profile: SafetyProfile): { min: number; max: number } {
  const max = Math.min(cardioValue(`zone.${intensity}.rpeMax` as CardioConfigKey), profile.maxRPE);
  const min = Math.min(cardioValue(`zone.${intensity}.rpeMin` as CardioConfigKey), max);
  return { min, max };
}

export interface ZoneFacts {
  readonly profile: SafetyProfile;
  readonly birthDate?: CalendarDateValue | null;
  /** SAF-12: the user's local calendar date (age on it). */
  readonly localDate?: CalendarDateValue | null;
  readonly heartRate?: HeartRateInfo | null;
  readonly nowMs: number;
}

export function zonesFor(facts: ZoneFacts): HrZoneSet {
  const age = ageOn(facts.birthDate, facts.nowMs, facts.localDate);
  const resting = facts.heartRate && facts.heartRate.source !== 'none' ? facts.heartRate.restingBpm : null;
  const hrMax = age !== null ? estimatedHrMax(age) : null;
  const reasons: string[] = [];
  const hrr = resting !== null && hrMax !== null && hrMax - resting >= cardioValue('hrr.minReserveBpm');
  const zones: HrZone[] = INTENSITIES.map((intensity) => {
    const rpe = rpeRange(intensity, facts.profile);
    const band = hrr
      ? {
          minBpm: karvonenBpm(resting!, hrMax!, cardioValue(`zone.${intensity}.minFraction` as CardioConfigKey)),
          maxBpm: karvonenBpm(resting!, hrMax!, cardioValue(`zone.${intensity}.maxFraction` as CardioConfigKey)),
        }
      : { minBpm: null, maxBpm: null };
    return { intensity, ...band, rpeMin: rpe.min, rpeMax: rpe.max, talkTest: TALK[intensity] };
  });
  if (hrr) reasons.push('cardio.zones.heart_rate_reserve', 'cardio.zones.hr_max_estimated');
  else {
    reasons.push('cardio.zones.perceived_exertion');
    if (resting === null) reasons.push('cardio.zones.no_resting_hr');
    else if (hrMax === null) reasons.push('cardio.zones.no_age');
    else reasons.push('cardio.zones.reserve_too_small');
  }
  reasons.push('cardio.zones.talk_test');
  return { method: hrr ? 'heart_rate_reserve' : 'perceived_exertion', hrMaxBpm: hrr ? hrMax : null, restingBpm: hrr ? resting : null, zones, reasonCodes: reasons };
}

export function zoneOf(zones: HrZoneSet, intensity: CardioIntensity): HrZone {
  return zones.zones.find((z) => z.intensity === intensity)!;
}
