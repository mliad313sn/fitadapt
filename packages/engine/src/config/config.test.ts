import { ConfigValueSchema, ReasonCodeSchema, unvalidatedKeys } from '@fitadapt/shared';
import { describe, expect, it } from 'vitest';
import { M02_REASON_CODES, M02_REASON_PARAMS, reasonParamsFor } from '../session/reason-codes.js';
import { ENGINE_CONFIGS, INCREMENT_CONFIG, SESSION_CONFIG, SESSION_RULES_VERSION } from './index.js';

describe('engine coefficients live in config with source and validated (goal condition 7)', () => {
  it('every value of every engine config has a source and is validated:false (no council sign-off exists)', () => {
    let count = 0;
    for (const [name, config] of Object.entries(ENGINE_CONFIGS)) {
      for (const [key, value] of Object.entries(config)) {
        count += 1;
        expect(ConfigValueSchema.safeParse(value).success, `${name}.${key}`).toBe(true);
        expect(value.source.trim().length, `${name}.${key}`).toBeGreaterThan(10);
        expect(value.validated, `${name}.${key}`).toBe(false);
        expect(value.validatedBy, `${name}.${key}`).toBeUndefined();
      }
      expect(unvalidatedKeys(config)).toEqual(Object.keys(config).sort());
    }
    expect(count).toBeGreaterThan(150);
    // M04 adds the analytics config (read-only: trend, rate, guardrail, forecasts); M09 the pair planner and Fair Challenge Score.
    expect(Object.keys(ENGINE_CONFIGS).sort()).toEqual(['analytics', 'assessment', 'cardio', 'firstSession', 'increments', 'pair', 'program', 'recovery', 'session', 'substitution']);
  });

  it('M02 values that come from the spec cite it; the rest say they are engineering defaults', () => {
    for (const key of ['progression.upperIncrementFraction', 'progression.lowerIncrementFraction', 'regression.rpeThreshold', 'regression.sessionsBelowRange', 'progression.variantSessions', 'repRange.hypertrophy.min'] as const) {
      expect(SESSION_CONFIG[key].source).toContain('docs/specs/M02');
    }
    expect(SESSION_CONFIG['regression.loadReductionFraction'].value).toBeGreaterThanOrEqual(0.05);
    expect(SESSION_CONFIG['regression.loadReductionFraction'].value).toBeLessThanOrEqual(0.1);
    for (const v of Object.values(INCREMENT_CONFIG)) expect(v.source).toMatch(/engineering default/);
    expect(SESSION_RULES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('safety invariants are not configuration: no S1/S2/S3/S5/S7 number appears in any config', () => {
    for (const config of Object.values(ENGINE_CONFIGS)) {
      for (const key of Object.keys(config)) expect(key).not.toMatch(/^s[1-7]\b|\bs[1-7]\.|loadCeiling|maxIncrease|s5Window|painRed|redPain/i);
    }
  });
});

describe('M02 reason codes', () => {
  it('are unique dotted codes with named parameters', () => {
    expect(new Set(M02_REASON_CODES).size).toBe(M02_REASON_CODES.length);
    for (const code of M02_REASON_CODES) expect(ReasonCodeSchema.safeParse(code).success, code).toBe(true);
    for (const params of Object.values(M02_REASON_PARAMS)) for (const p of params) expect(p).toMatch(/^[a-z][a-zA-Z]+$/);
    expect(reasonParamsFor('session.progression.load_increased')).toEqual(['deltaKg', 'sets', 'reps', 'rir']);
    expect(reasonParamsFor('session.first.from_assessment')).toEqual([]);
  });
});
