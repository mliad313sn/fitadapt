import { describe, expect, it } from 'vitest';
import { lintClaims, normaliseClaimText, type ClaimLocale } from './index.js';

// Regression tests for PKG-05 (packages/tooling review): typography and inflections must not hide a claim.

describe('PKG-05: claims linter evasions', () => {
  const evasions: readonly (readonly [ClaimLocale, string])[] = [
    ['en', 'Clinically  proven results'],
    ['en', 'Clinically\nproven results'],
    ['en', 'Our fat–burning plan'],
    ['en', 'Our fat—burning plan'],
    ['en', 'Burn more fat every session'],
    ['en', 'Burned fat, guaranteed'],
    ['en', 'An injury-prevention program'],
    ['en', 'An injury prevention program'],
    ['en', 'Lose up to 5 kg in 2 weeks'],
    ['en', 'Lose five kg in two weeks'],
    ['en', 'cu​re your back pain'],
    ['en', 'di­agnose'],
    ['en', 'tr⁠eat'],
    ['en', 'ｃｕｒｅ your back'],
    ['fr', 'guérir votre dos'.normalize('NFD')],
    ['fr', 'Votre douleur sera guérie'],
    ['fr', 'Ce programme guérira votre dos'],
    ['fr', 'Cliniquement  prouvé'],
    ['fr', 'Cliniquement\nprouvé'],
    ['fr', 'brûlez  plus de graisses'],
    ['fr', 'Perdez jusqu’à 5 kg en 2 semaines'],
    ['fr', 'Perdez cinq kilos en deux semaines'],
    ['fr', 'soignera vos tendinites'],
  ];
  it.each(evasions)('%s: %j is caught', (locale, text) => {
    expect(lintClaims([{ source: 'probe', locale, text }]).length).toBeGreaterThan(0);
  });

  it('normalises typography but keeps a blank line as a break', () => {
    expect(normaliseClaimText('A  b\n  c\r\n\r\nD‑e')).toBe('a b c\nd-e');
  });

  it('still allows ordinary copy and substantiated phrases', () => {
    expect(lintClaims([{ source: 'ok', locale: 'en', text: 'Warm up for five minutes, then lift with care.' }])).toEqual([]);
    expect(lintClaims([{ source: 'ok', locale: 'fr', text: 'Échauffez-vous cinq minutes, puis soulevez avec soin.' }])).toEqual([]);
    const entry = { id: 'x', phrase: 'does not diagnose', locale: 'en' as const, kind: 'disclaimer' as const, evidence: 'wellness positioning', scope: 'any', review: 'pending' };
    expect(lintClaims([{ source: 'ok', locale: 'en', text: 'This app does  not\ndiagnose.' }], [entry])).toEqual([]);
  });
});
