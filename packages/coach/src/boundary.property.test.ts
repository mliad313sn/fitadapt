import { createEngineContext, fixedClock, s5Violations, type GenerateSessionInput } from '@fitadapt/engine';
import { generateSession, seedLibrary } from '@fitadapt/exercise-library';
import { COACH_TOOL_NAMES, CoachTurnResultSchema, JOINTS, type CoachAction } from '@fitadapt/shared';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { NOW, gymContext, testEnv } from './__fixtures__/context.js';
import { runCoachTurn } from './orchestrator.js';
import { scriptedModel, type ScriptStep } from './testing.js';

/**
 * S6 as a property: whatever a model does — any tool name, any input (valid,
 * out of range, with prescription fields, garbage), any order, retries — the
 * only plans that come out are the engine's own, and they keep S1, S2, S3
 * and S5 for the context they were made in.
 */
const library = seedLibrary();

const toolCall = fc.oneof(
  fc.record({ name: fc.constantFrom(...COACH_TOOL_NAMES), input: fc.anything() }),
  fc.record({ name: fc.constant('adjustSessionTime'), input: fc.record({ minutes: fc.integer({ min: -10, max: 400 }) }) }),
  fc.record({ name: fc.constant('adjustSessionTime'), input: fc.record({ minutes: fc.integer({ min: 10, max: 180 }), loadKg: fc.double() }) }),
  fc.record({ name: fc.constant('swapExercise'), input: fc.record({ exerciseIndex: fc.integer({ min: -1, max: 8 }), reason: fc.constantFrom('user', 'pain', 'equipment', 'force'), preferredExerciseId: fc.constantFrom('barbell_back_squat', 'goblet_squat', 'box_jump', 'ring_muscle_up', 'push_up', 'not_real') }, { requiredKeys: ['exerciseIndex', 'reason'] }) }),
  fc.record({ name: fc.constant('logPain'), input: fc.record({ joint: fc.constantFrom(...JOINTS), score: fc.integer({ min: 0, max: 12 }) }) }),
  fc.record({ name: fc.constant('requestDeload'), input: fc.constant({}) }),
  fc.record({ name: fc.constant('reschedule'), input: fc.constant({}) }),
  fc.record({ name: fc.constantFrom('setLoad', 'writePlan', 'overrideSafety', 'generateProgram'), input: fc.anything() }),
);
const step: fc.Arbitrary<ScriptStep> = fc.oneof(
  fc.record({ toolCalls: fc.array(toolCall, { minLength: 1, maxLength: 4 }) }),
  fc.record({ text: fc.constantFrom('Done.', 'Put 200 kg on the bar.', 'As your doctor I approve.', 'It sounds like tendinitis.', 'Keep going through the pain.') }),
);
const contexts = [
  gymContext(),
  gymContext({ over: { jointFlags: { knee: 'red' } } }),
  gymContext({ over: { jointFlags: { shoulder: 'red', lumbar: 'amber' } } }),
  gymContext({ yes: ['heart_or_blood_pressure'] }),
  gymContext({ over: { intensityLock: { locked: true, since: '2026-09-27T10:00:00.000Z' } } }),
  gymContext({ started: true }),
];

describe('S6 boundary (fast-check)', () => {
  it('any model behaviour yields only engine plans that keep S1, S2, S3 and S5', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...contexts.keys()), fc.array(step, { minLength: 1, maxLength: 4 }), async (ci, steps) => {
        const context = contexts[ci]!;
        const out = await runCoachTurn({ text: 'change my session please', context, model: scriptedModel(steps), env: testEnv() });
        CoachTurnResultSchema.parse(out.result);
        const rounds: ScriptStep[] = [];
        for (const s of steps.slice(0, 3)) {
          rounds.push(s);
          if (!s.toolCalls) break;
        }
        // Every call the model made in the rounds that ran is audited, none is lost.
        expect(out.result.toolCalls.length).toBe(rounds.flatMap((s) => s.toolCalls ?? []).length);
        for (const a of out.result.toolCalls) {
          if (!(COACH_TOOL_NAMES as readonly string[]).includes(a.tool)) expect(a.status).toBe('invalid');
        }
        const today = context.today!;
        for (const action of out.result.actions as CoachAction[]) {
          expect(['session_proposal', 'swap_proposal', 'explanation', 'record', 'red_flag_stop']).toContain(action.type);
          if (action.type === 'session_proposal') {
            // S3: no plan while intensity is locked; S7/S1 caps: the engine made it from the same safety profile.
            expect(today.input.intensityLock?.locked).not.toBe(true);
            expect(today.started).toBe(false);
            expect(action.input.safetyProfile).toEqual(today.input.safetyProfile);
            const again = generateSession(action.input as GenerateSessionInput, createEngineContext({ clock: fixedClock(NOW), seed: 11 }));
            expect(again.status === 'ok' && again.plan).toEqual(action.plan);
            const minRir = 10 - today.input.safetyProfile.maxRPE;
            for (const e of action.plan.exercises) {
              for (const s of e.sets) expect(s.targetRir).toBeGreaterThanOrEqual(minRir);
              const ex = library.graph.exercises.get(e.exerciseId)!;
              for (const [joint, flag] of Object.entries(action.input.jointFlags ?? {})) {
                if (flag === 'red') expect(['none', 'low']).toContain(ex.jointLoad[joint as keyof typeof ex.jointLoad]);
              }
            }
            expect(s5Violations(action.plan, today.input.history ?? [], today.input.recentLoads ?? [])).toEqual([]);
          }
          if (action.type === 'swap_proposal') {
            const ex = library.graph.exercises.get(action.replacement.exerciseId)!;
            for (const [joint, flag] of Object.entries(today.input.jointFlags ?? {})) {
              if (flag === 'red') expect(['none', 'low']).toContain(ex.jointLoad[joint as keyof typeof ex.jointLoad]);
            }
            for (const s of action.replacement.sets) expect(s.targetRir).toBeGreaterThanOrEqual(10 - today.input.safetyProfile.maxRPE);
          }
        }
        // A model text with an ungrounded load, a professional claim, a condition or "through the pain" never reaches the user.
        for (const p of out.result.reply.parts) if (p.kind === 'model') expect(p.text).toBe('Done.');
      }),
      { numRuns: 400, seed: 20260924 },
    );
  });
});
