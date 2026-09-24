import { catalogues } from '@fitadapt/i18n';
import type { CoachContext } from '@fitadapt/shared';
import type { Retrieved } from './content.js';
import { numbersIn } from './guard.js';

/**
 * The per-turn part of the system prompt: the minimal context (spec: profile
 * summary, SafetyProfile, current program and recent logs) and the grounding
 * entries. Data minimisation (M17, L9): no name, email, date of birth, body
 * weight, screening answer or free-text note is sent to the model; the
 * SafetyProfile is reduced to the limits the engine applies.
 */
export function turnPrompt(context: CoachContext, grounding: readonly Retrieved[]): string {
  const name = (id: string) => (catalogues[context.locale] as Readonly<Record<string, string>>)[`exercise.${id}.name`] ?? id;
  const lines: string[] = [`Reply in ${context.locale === 'fr' ? 'French' : 'English'}.`];
  const today = context.today;
  if (today) {
    const sp = today.input.safetyProfile;
    const flags = Object.entries(today.input.jointFlags ?? {}).filter(([, v]) => v !== 'green');
    lines.push(
      'Safety limits the engine applies (do not discuss health details beyond these):',
      `- effort limit: RPE ${sp.maxRPE}; intervals ${sp.allowHIIT ? 'allowed' : 'not allowed'}; maximal tests ${sp.allowMaxTests ? 'allowed' : 'not allowed'}`,
      `- joints rated painful: ${flags.length ? flags.map(([j, v]) => `${j} (${v})`).join(', ') : 'none'}`,
      `- training paused after warning signs: ${today.input.intensityLock?.locked ? 'yes' : 'no'}; lighter phase: ${today.input.deload ? 'yes' : 'no'}; low readiness today: ${today.input.readiness === 'reduced' ? 'yes' : 'no'}`,
      `Today: ${today.input.minutesAvailable} minutes available; session ${today.started ? 'in progress' : 'not started'}.`,
    );
    if (today.plan) {
      lines.push(`Today's plan (made by the engine; estimated ${today.plan.estimatedMinutes} minutes; reserve ${today.plan.targetRir} reps):`);
      today.plan.exercises.forEach((e, i) => {
        const sets = e.sets.map((s) => `${s.target.kind === 'reps' ? `${s.target.min}-${s.target.max} reps` : `${s.target.seconds} s hold`}${s.loadKg !== null ? ` at ${s.loadKg} kg` : ''}, RIR ${s.targetRir}`).join('; ');
        lines.push(`${i}. ${e.exerciseId} (${name(e.exerciseId)}): ${e.sets.length} sets — ${sets}`);
      });
    } else lines.push("Today's plan: not generated.");
  } else lines.push('No plan for today is available.');
  if (context.program) lines.push(`A program exists (today is ${context.program.today}).`);
  if (grounding.length > 0) {
    lines.push('Reviewed content you may answer from (cite each one you use as [ref:<id>]):');
    for (const g of grounding) lines.push(`<content id="${g.id}">${g.text}</content>`);
  } else lines.push('No reviewed content matches this question: do not answer knowledge questions from your own knowledge.');
  return lines.join('\n');
}

/** Numbers the model may repeat: those in the context and grounding it received, and in tool results. */
export function groundedNumbers(texts: readonly string[]): Set<number> {
  const out = new Set<number>();
  for (const t of texts) for (const n of numbersIn(t)) out.add(n);
  return out;
}
