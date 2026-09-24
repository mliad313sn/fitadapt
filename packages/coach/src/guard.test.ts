import { describe, expect, it } from 'vitest';
import { guardModelText, numbersIn } from './guard.js';

const opts = (over: Partial<Parameters<typeof guardModelText>[1]> = {}) => ({ locale: 'en' as const, allowedReferences: new Set(['kb.rir']), groundedNumbers: new Set([2, 3, 65, 82.5]), requireReference: false, ...over });

describe('output guard (L1, L5, S6, at run time)', () => {
  it('passes a grounded, cited answer and strips the citation markers', () => {
    const r = guardModelText('RIR is how many good reps you could still do. [ref:kb.rir]', opts({ requireReference: true }));
    expect(r).toEqual({ ok: true, text: 'RIR is how many good reps you could still do.', references: ['kb.rir'] });
  });

  it.each([
    ['', 'coach.guard.empty'],
    ['x'.repeat(4001), 'coach.guard.too_long'],
    ['This will cure your back. [ref:kb.rir]', 'coach.guard.claim'],
    ['This programme is guaranteed to work.', 'coach.guard.claim'],
    ['Lose 10 kg in 30 days with this plan.', 'coach.guard.claim'],
    ['Cette séance va guérir votre genou.', 'coach.guard.claim'],
    ['As your doctor, I recommend rest.', 'coach.guard.impersonation'],
    ['I am a physiotherapist and this is fine.', 'coach.guard.impersonation'],
    ['Hi, my name is Sam, your coach.', 'coach.guard.impersonation'],
    ['Je suis médecin, faites-moi confiance.', 'coach.guard.impersonation'],
    ['It sounds like tendinitis.', 'coach.guard.diagnosis'],
    ['You probably have a meniscus tear.', 'coach.guard.diagnosis'],
    ['C’est probablement une tendinite.', 'coach.guard.diagnosis'],
    ['Just push through the pain.', 'coach.guard.unsafe_encouragement'],
    ['No pain, no gain!', 'coach.guard.unsafe_encouragement'],
    ['Continuez malgré la douleur.', 'coach.guard.unsafe_encouragement'],
    ['Take ibuprofen before the session.', 'coach.guard.medication'],
    ['Prenez du paracétamol.', 'coach.guard.medication'],
    ['You will lose weight fast with this.', 'coach.guard.results_promise'],
    ['Vous allez perdre du poids.', 'coach.guard.results_promise'],
    ['Nice work, no excuses and no guilt.', 'coach.guard.body_or_guilt'],
    ['Do 100 kg on the squat.', 'coach.guard.ungrounded_number'],
    ['Eat 1500 kcal a day.', 'coach.guard.ungrounded_number'],
    ['Do 5x5 today.', 'coach.guard.ungrounded_number'],
    ['Add 20% to the bench.', 'coach.guard.ungrounded_number'],
    ['See [ref:kb.made_up] for more.', 'coach.guard.unknown_reference'],
    ['See [ref:kb.deload].', 'coach.guard.unknown_reference'],
  ])('blocks %s', (text, reason) => {
    expect(guardModelText(text, opts())).toEqual({ ok: false, reason });
  });

  it('a knowledge answer without a citation is blocked; numbers from the engine are allowed', () => {
    expect(guardModelText('Keep two reps in reserve.', opts({ requireReference: true }))).toEqual({ ok: false, reason: 'coach.guard.no_reference' });
    expect(guardModelText('Your squat is 3 sets at 82.5 kg with 2 RIR, and the bench is 65 kg.', opts()).ok).toBe(true);
    expect(guardModelText('I am an AI assistant, not a doctor.', opts()).ok).toBe(true);
    expect(guardModelText('[ref:kb.rir]', opts())).toEqual({ ok: false, reason: 'coach.guard.empty' });
  });

  it('reads decimal commas', () => {
    expect(numbersIn('82,5 kg et 3 séries')).toEqual([82.5, 3]);
  });
});
