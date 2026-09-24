import { catalogues } from '@fitadapt/i18n';
import { lintClaims } from '@fitadapt/legal';
import { describe, expect, it } from 'vitest';
import { COACH_CONFIG } from './config.js';
import { COACH_CONTENT, assertCoachContentReleaseReady, exercisesNamed, isCoachContentId, retrieve, unapprovedContent } from './content.js';
import { COACH_SCREEN_CONFIG } from './screen.config.js';

describe('coach knowledge registry (grounding, goal condition 5)', () => {
  it('every entry has FR and EN wording, passes the claims linter, and names the seats that must approve it', () => {
    expect(COACH_CONTENT.length).toBeGreaterThanOrEqual(20);
    for (const e of COACH_CONTENT) {
      for (const locale of ['en', 'fr'] as const) {
        const cat = catalogues[locale] as Record<string, string>;
        expect(cat[e.title], `${e.id} ${locale}`).toBeTruthy();
        expect(cat[e.body], `${e.id} ${locale}`).toBeTruthy();
        expect(lintClaims([{ source: e.id, locale, text: `${cat[e.title]} ${cat[e.body]}` }])).toEqual([]);
      }
      expect(e.reviews.length).toBeGreaterThan(0);
      expect(e.keywords.en.length + e.keywords.fr.length).toBeGreaterThan(0);
    }
    expect(new Set(COACH_CONTENT.map((e) => e.id)).size).toBe(COACH_CONTENT.length);
  });

  it('no entry is approved yet, and production refuses unapproved content (the M20/M06 release rule)', () => {
    expect(unapprovedContent()).toHaveLength(COACH_CONTENT.length);
    expect(() => assertCoachContentReleaseReady({ production: false })).not.toThrow();
    expect(() => assertCoachContentReleaseReady({ production: true })).toThrow(/coach knowledge entries lack council approval/);
    const approved = [{ ...COACH_CONTENT[0]!, reviews: [{ seat: 'A3' as const, status: 'approved' as const, signOff: 'docs/governance/sign-offs/x.md' }] }];
    expect(() => assertCoachContentReleaseReady({ production: true }, approved)).not.toThrow();
    expect(() => assertCoachContentReleaseReady({ production: true }, [{ ...approved[0]!, reviews: [{ seat: 'A3' as const, status: 'approved' as const }] }])).toThrow(/entry lacks/);
  });

  it('retrieves FR and EN questions, and exercises by name in either language', () => {
    expect(retrieve('What is RIR?', 'en')[0]!.id).toBe('kb.rir');
    expect(retrieve('C’est quoi les répétitions en réserve ?', 'fr')[0]!.id).toBe('kb.rir');
    expect(retrieve('How long should I rest between sets?', 'en')[0]!.id).toBe('kb.rest_between_sets');
    expect(retrieve('Pourquoi la charge ne monte pas plus vite que 10 % ?', 'fr').map((r) => r.id)).toContain('kb.load_ceiling');
    expect(retrieve('How do I do a goblet squat?', 'en')[0]).toMatchObject({ id: 'exercise.goblet_squat' });
    expect(exercisesNamed('comment faire un squat gobelet')).toContain('goblet_squat');
    expect(retrieve('What is the capital of France?', 'en')).toEqual([]);
    expect(retrieve('What is RIR?', 'fr')[0]!.text).toContain('Répétitions en réserve');
  });

  it('knows which ids may be cited', () => {
    expect(isCoachContentId('kb.rir')).toBe(true);
    expect(isCoachContentId('exercise.goblet_squat')).toBe(true);
    expect(isCoachContentId('exercise.made_up')).toBe(false);
    expect(isCoachContentId('kb.made_up')).toBe(false);
  });

  it('every coach number is config with a source and validated:false (CLAUDE.md rule 4)', () => {
    for (const cfg of [COACH_CONFIG, COACH_SCREEN_CONFIG]) {
      for (const v of Object.values(cfg)) expect(v).toMatchObject({ validated: false, source: expect.stringMatching(/ADR-024/) });
    }
  });
});
