import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GenerateSessionInputSchema, GenerateSessionResultSchema, ProgressionDecisionSchema, ProgressionInputSchema } from '@fitadapt/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAFE_FACTS, FULL_GYM, profileFrom } from './__fixtures__/library.js';
import { GYM_ID, GYM_LOADS, SESSION_LIBRARY, programContext } from './__fixtures__/session.js';
import { Diary, atTop } from './__fixtures__/simulate.js';
import * as engine from './index.js';

/**
 * Goal condition 1: packages/engine exports generateSession() and
 * evaluateProgression() with zod-typed input and output; the package has no
 * I/O imports and uses only the injected clock and seed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const roots = [here, join(here, '../../safety/src')];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sources(path);
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

const ALLOWED_PACKAGES = ['@fitadapt/shared', '@fitadapt/safety', 'zod'];
const FORBIDDEN: [RegExp, string][] = [
  [/\bDate\.now\s*\(/, 'Date.now()'],
  [/\bnew Date\(\s*\)/, 'new Date()'],
  [/\bMath\.random\s*\(/, 'Math.random()'],
  [/\bperformance\.now\s*\(/, 'performance.now()'],
  [/\bfetch\s*\(/, 'fetch()'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/, 'browser storage'],
  [/\bsetTimeout\s*\(|\bsetInterval\s*\(/, 'timers'],
  [/\bprocess\.\w/, 'process'],
  [/\brequire\s*\(/, 'require()'],
  [/\bcrypto\.\w/, 'crypto'],
  [/\bimport\s*\(/, 'dynamic import'],
];

describe('the engine is pure (goal condition 1)', () => {
  const files = roots.flatMap(sources);

  it('imports only its own files, packages/shared, packages/safety and zod: no node:, no network, no storage, no UI', () => {
    expect(files.length).toBeGreaterThan(30);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bfrom\s+'([^']+)'|\bimport\s+'([^']+)'/g)) {
        const spec = m[1] ?? m[2]!;
        if (spec.startsWith('./') || spec.startsWith('../')) continue;
        if (!ALLOWED_PACKAGES.includes(spec)) offenders.push(`${relative(here, file)} imports ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
    // packages/safety itself depends on packages/shared only (no cycle back to the engine).
    expect(JSON.parse(readFileSync(join(here, '../../safety/package.json'), 'utf8')).dependencies).toEqual({ '@fitadapt/shared': 'workspace:*' });
    expect(Object.keys(JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')).dependencies).sort()).toEqual(['@fitadapt/safety', '@fitadapt/shared']);
  });

  it('never reads the system clock, randomness, timers, the network or the environment', () => {
    const offenders: string[] = [];
    for (const file of files) {
      // Comments may name what is forbidden; code may not.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "''");
      for (const [re, what] of FORBIDDEN) if (re.test(code)) offenders.push(`${relative(here, file)}: ${what}`);
    }
    expect(offenders).toEqual([]);
  });

  describe('at run time, only the injected clock and seed matter', () => {
    afterEach(() => vi.restoreAllMocks());
    const input = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: [...FULL_GYM, 'cable_station' as const], equipmentLoads: GYM_LOADS, equipmentProfileId: GYM_ID, minutesAvailable: 45, programSession: programContext(), experience: 'intermediate' as const };
    const run = (clockMs: number, seed: number) => {
      const ctx = engine.createEngineContext({ clock: engine.fixedClock(clockMs), seed });
      const first = engine.generateSession(input, SESSION_LIBRARY, ctx);
      if (first.status !== 'ok') throw new Error('expected a plan');
      const diary = new Diary();
      diary.add(input, first.plan, atTop(40));
      const second = engine.generateSession({ ...input, history: diary.history() }, SESSION_LIBRARY, engine.createEngineContext({ clock: engine.fixedClock(clockMs + 2 * 86_400_000), seed: seed + 1 }));
      return { first, second };
    };

    it('works with the system clock, Math.random and the network all poisoned, and gives the same plans', () => {
      const clean = run(Date.parse('2026-09-28T08:00:00.000Z'), 9);
      vi.spyOn(Date, 'now').mockImplementation(() => {
        throw new Error('the engine read Date.now()');
      });
      vi.spyOn(Math, 'random').mockImplementation(() => {
        throw new Error('the engine read Math.random()');
      });
      vi.spyOn(performance, 'now').mockImplementation(() => {
        throw new Error('the engine read performance.now()');
      });
      vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
        throw new Error('the engine called fetch()');
      });
      expect(run(Date.parse('2026-09-28T08:00:00.000Z'), 9)).toEqual(clean);
    });

    it('another clock or seed changes the stamp and plan id, nothing hidden', () => {
      const a = run(Date.parse('2026-09-28T08:00:00.000Z'), 9).first;
      const b = run(Date.parse('2026-09-28T08:00:00.000Z'), 10).first;
      const c = run(Date.parse('2026-09-29T08:00:00.000Z'), 9).first;
      if (a.status !== 'ok' || b.status !== 'ok' || c.status !== 'ok') throw new Error('expected plans');
      expect(b.plan.planId).not.toBe(a.plan.planId);
      expect({ ...b.plan, planId: a.plan.planId, seed: a.plan.seed }).toEqual(a.plan);
      expect(c.plan.generatedAt).toBe('2026-09-29T08:00:00.000Z');
      expect({ ...c.plan, generatedAt: a.plan.generatedAt }).toEqual(a.plan);
    });
  });

  it('exports generateSession() and evaluateProgression() whose input and output are zod schemas in packages/shared', () => {
    expect(typeof engine.generateSession).toBe('function');
    expect(typeof engine.evaluateProgression).toBe('function');
    const input = { ...SAFE_FACTS, safetyProfile: profileFrom(), equipment: [...FULL_GYM], minutesAvailable: 45, programSession: programContext() };
    expect(GenerateSessionInputSchema.parse(input)).toEqual(input);
    const out = engine.generateSession(input, SESSION_LIBRARY, engine.createEngineContext({ clock: engine.fixedClock(0), seed: 1 }));
    expect(GenerateSessionResultSchema.parse(out)).toEqual(out);
    const pin = { exerciseId: 'push_up', pattern: 'horizontal_push' as const, loading: 'bodyweight' as const, target: { kind: 'reps' as const, min: 6, max: 10 }, targetRir: 2, sessions: [], implement: null, loadReferences: [], asOf: '2026-09-28T08:00:00.000Z' };
    expect(ProgressionInputSchema.parse(pin)).toEqual(pin);
    expect(ProgressionDecisionSchema.parse(engine.evaluateProgression(pin))).toEqual(engine.evaluateProgression(pin));
    // Invalid input never reaches the rules.
    expect(() => engine.generateSession({ ...input, minutesAvailable: Number.NaN }, SESSION_LIBRARY, engine.createEngineContext({ clock: engine.fixedClock(0), seed: 1 }))).toThrow();
  });
});
