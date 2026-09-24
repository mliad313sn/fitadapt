import { describe, expect, it } from 'vitest';
import { COACH_TOOL_BOUNDS, COACH_TOOL_NAMES, CoachMessageRequestSchema, CoachReplyPartSchema, CoachToolInputSchemas, ToolCallAuditSchema } from './coach.js';
import { DataExportSchema } from './privacy.js';

describe('M11 coach contracts', () => {
  it('tool inputs are strict and carry no prescription', () => {
    expect(COACH_TOOL_NAMES).toHaveLength(7);
    expect(CoachToolInputSchemas.adjustSessionTime.safeParse({ minutes: 30 }).success).toBe(true);
    expect(CoachToolInputSchemas.adjustSessionTime.safeParse({ minutes: 30, loadKg: 100 }).success).toBe(false);
    expect(CoachToolInputSchemas.adjustSessionTime.safeParse({ minutes: COACH_TOOL_BOUNDS.minutesMax.value + 1 }).success).toBe(false);
    expect(CoachToolInputSchemas.swapExercise.safeParse({ exerciseIndex: 0, reason: 'user', preferredExerciseId: 'goblet_squat' }).success).toBe(true);
    expect(CoachToolInputSchemas.requestDeload.safeParse({ sets: 2 }).success).toBe(false);
    expect(CoachToolInputSchemas.logPain.safeParse({ joint: 'knee', score: 11 }).success).toBe(false);
    expect(CoachToolInputSchemas.reportRedFlag.safeParse({ symptom: 'palpitations' }).success).toBe(true);
    expect(COACH_TOOL_BOUNDS.minutesMin).toMatchObject({ validated: false });
  });

  it('a reply part is an i18n key with values, or model text', () => {
    expect(CoachReplyPartSchema.safeParse({ kind: 'template', key: 'coach.reply.swap.proposed', values: { from: { key: 'exercise.push_up.name' }, n: 3 } }).success).toBe(true);
    expect(CoachReplyPartSchema.safeParse({ kind: 'template', key: 'Bad Key!', values: {} }).success).toBe(false);
    expect(CoachReplyPartSchema.safeParse({ kind: 'model', text: '', locale: 'en' }).success).toBe(false);
  });

  it('messages are bounded; audits need a reason code', () => {
    const context = { locale: 'en', jurisdiction: 'GB', today: null, program: null };
    expect(CoachMessageRequestSchema.safeParse({ text: 'hi', context }).success).toBe(true);
    expect(CoachMessageRequestSchema.safeParse({ text: 'x'.repeat(2001), context }).success).toBe(false);
    expect(CoachMessageRequestSchema.safeParse({ text: '   ', context }).success).toBe(false);
    expect(ToolCallAuditSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001', tool: 'setLoad', input: {}, status: 'invalid', reasonCode: 'coach.tool.unknown', reasonCodes: [], engineVersion: '0.4.0', at: '2026-09-28T07:00:00.000Z' }).success).toBe(true);
  });

  it('exports made before M11 have an empty coach section', () => {
    expect(DataExportSchema.shape.coach.parse(undefined)).toEqual({ conversations: [] });
  });
});
