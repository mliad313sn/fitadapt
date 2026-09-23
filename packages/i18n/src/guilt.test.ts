import { describe, expect, it } from 'vitest';
import { en, fr, guiltPhrases } from './index.js';

/** M08 goal condition 5: copy after a missed session passes a "no guilt" denylist in FR and EN. */
const AFTER_A_MISSED_SESSION = (key: string) => key.startsWith('calendar.reflow.') || key.startsWith('engine.reason.program.reflow.') || key.startsWith('calendar.skipped') || key.startsWith('calendar.moved') || key.startsWith('calendar.merged') || key.startsWith('calendar.cantMakeIt');

describe('no-guilt copy after a missed session (M08)', () => {
  it('every reflow message passes the denylist, in English and in French', () => {
    const keys = Object.keys(en).filter(AFTER_A_MISSED_SESSION);
    expect(keys.length).toBeGreaterThanOrEqual(14);
    for (const key of keys) {
      expect(guiltPhrases(en[key as keyof typeof en], 'en'), `en ${key}`).toEqual([]);
      expect(guiltPhrases(fr[key as keyof typeof fr], 'fr'), `fr ${key}`).toEqual([]);
    }
  });

  it('the whole M08 program and calendar copy passes it too', () => {
    for (const key of Object.keys(en).filter((k) => k.startsWith('calendar.') || k.startsWith('engine.reason.program.') || k.startsWith('home.calendar.'))) {
      expect(guiltPhrases(en[key as keyof typeof en], 'en'), key).toEqual([]);
      expect(guiltPhrases(fr[key as keyof typeof fr], 'fr'), key).toEqual([]);
    }
  });

  it('catches blame, pressure and catch-up language (mutation check), ignoring case and accents', () => {
    expect(guiltPhrases('You missed Friday again? Don’t give up!', 'en')).toEqual(['you missed', 'don’t give up', 'again?']);
    expect(guiltPhrases('Catch up on Saturday so you don’t fall behind.', 'en')).toEqual(['fall behind', 'catch up']);
    expect(guiltPhrases('Vous avez manqué vendredi : rattrapez-la samedi.', 'fr')).toEqual(['vous avez manque', 'rattrap']);
    expect(guiltPhrases('Quel ÉCHEC, vous êtes en retard.', 'fr')).toEqual(['echec', 'en retard']);
    expect(guiltPhrases('No problem. Friday is now on Saturday.', 'en')).toEqual([]);
  });
});
