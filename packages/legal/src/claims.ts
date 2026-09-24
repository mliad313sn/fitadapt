/**
 * Claims control (L1). Deny rules for medical and results claims in FR and
 * EN, applied to i18n catalogues, store metadata, AI-coach prompts, marketing
 * copy and AI eval outputs. A hit fails unless the phrase is an entry of the
 * substantiation file (docs/legal/substantiation-file.md) with evidence.
 * docs/adr/ADR-010-claims-control.md.
 *
 * The rules are deliberately broad: a false positive costs a rewording or a
 * reviewed substantiation entry; a missed claim can make the app a medical
 * device or an unfair commercial practice.
 */
export type ClaimLocale = 'en' | 'fr';
export type ClaimCategory = 'medical' | 'results' | 'fat_loss';

export interface DenyRule {
  readonly id: string;
  readonly locale: ClaimLocale;
  readonly category: ClaimCategory;
  readonly description: string;
  readonly pattern: RegExp;
}

// Patterns are literals (no dynamic RegExp) with bounded quantifiers only.
// (?<!\p{L}) / (?!\p{L}) are Unicode-aware word boundaries (\b is ASCII-only).
export const CLAIM_DENYLIST: readonly DenyRule[] = Object.freeze([
  { id: 'en.diagnose', locale: 'en', category: 'medical', description: 'diagnose / diagnosis', pattern: /(?<!\p{L})diagnos(?:e|es|ed|ing|is|tic|tics)(?!\p{L})/giu },
  { id: 'en.treat', locale: 'en', category: 'medical', description: 'treat / treatment', pattern: /(?<!\p{L})treat(?:s|ed|ing|ment|ments)?(?!\p{L})/giu },
  { id: 'en.cure', locale: 'en', category: 'medical', description: 'cure', pattern: /(?<!\p{L})cur(?:e|es|ed|ing|ative)(?!\p{L})/giu },
  { id: 'en.heal', locale: 'en', category: 'medical', description: 'heal', pattern: /(?<!\p{L})heal(?:s|ed|ing)?(?!\p{L})/giu },
  {
    id: 'en.prevent_disease',
    locale: 'en',
    category: 'medical',
    description: 'prevent + disease, illness, injury or condition',
    pattern: /(?<!\p{L})prevent(?:s|ed|ing|ion|ive)?(?!\p{L})[^.!?\n]{0,40}(?<!\p{L})(?:diseases?|illness(?:es)?|injur(?:y|ies)|conditions?|diabetes|cancer|heart attacks?)(?!\p{L})/giu,
  },
  { id: 'en.clinically_proven', locale: 'en', category: 'medical', description: 'clinically / medically proven', pattern: /(?<!\p{L})(?:clinically|medically|scientifically) proven(?!\p{L})/giu },
  { id: 'en.guarantee', locale: 'en', category: 'results', description: 'guarantee(d) results', pattern: /(?<!\p{L})guarantee(?:s|d)?(?!\p{L})/giu },
  {
    id: 'en.lose_x_in_y',
    locale: 'en',
    category: 'results',
    description: 'lose N kg/lb in N days/weeks',
    pattern: /(?<!\p{L})lose\s{1,3}\d{1,3}\s{0,2}(?:kg|kilos?|lbs?|pounds)(?!\p{L})[^.!?\n]{0,20}(?<!\p{L})(?:in|within)\s{1,3}\d{1,3}\s{0,2}(?:days?|weeks?)(?!\p{L})/giu,
  },
  { id: 'en.burn_fat', locale: 'en', category: 'fat_loss', description: 'burn fat (fast) / fat-burning', pattern: /(?<!\p{L})(?:burn(?:s|ing)?\s{1,3}fat|burn(?:s|ing)?\s{1,3}belly\sfat|fat[\s-]burn(?:ing|er|ers)?)(?!\p{L})/giu },
  { id: 'en.melt_fat', locale: 'en', category: 'fat_loss', description: 'melt (away) fat', pattern: /(?<!\p{L})melt(?:s|ing)?\s{1,3}(?:away\sthe\s|away\s|the\s)?(?:fat|pounds|kilos)(?!\p{L})/giu },
  // M03 (C9): no lipolysis claim and no "fat-loss zone" — fat loss depends on energy balance, not on a heart-rate zone.
  { id: 'en.lipolysis', locale: 'en', category: 'fat_loss', description: 'lipolysis / lipolytic (e.g. "maximum lipolysis")', pattern: /(?<!\p{L})lipoly(?:sis|ses|tic)(?!\p{L})/giu },
  { id: 'en.fat_zone', locale: 'en', category: 'fat_loss', description: 'fat-loss / fat-melting zone', pattern: /(?<!\p{L})fat[\s-]{1,3}(?:loss|melting|oxidation|oxidising|oxidizing)\s{1,3}zones?(?!\p{L})/giu },
  // FIX-B: additions from the AI pre-reviews (docs/governance/ai-reviews/A4-A6-nutrition-behaviour.md M10-25:
  // metabolism and detox claims; B-legal-regulatory.md §3.6 (B4): rehab / recovery-from-injury wording, a medical-device risk).
  { id: 'en.boost_metabolism', locale: 'en', category: 'fat_loss', description: 'boost (your) metabolism', pattern: /(?<!\p{L})boost(?:s|ed|ing)?\s{1,3}(?:your\s|the\s)?metabolism(?!\p{L})/giu },
  { id: 'en.detox', locale: 'en', category: 'medical', description: 'detox / flush out toxins', pattern: /(?<!\p{L})(?:detox(?:es|ing|ify|ifying|ification)?|toxins?)(?!\p{L})/giu },
  { id: 'en.rehab', locale: 'en', category: 'medical', description: 'rehab / rehabilitation', pattern: /(?<!\p{L})rehab(?:s|ilitation|ilitate|ilitating)?(?!\p{L})/giu },
  {
    id: 'en.recover_from_injury',
    locale: 'en',
    category: 'medical',
    description: 'recover from (an) injury',
    pattern: /(?<!\p{L})recover(?:s|ed|ing|y)?\s{1,3}from\s(?:an\s|your\s|the\s)?injur(?:y|ies)(?!\p{L})/giu,
  },

  { id: 'fr.diagnostic', locale: 'fr', category: 'medical', description: 'diagnostic / diagnostiquer', pattern: /(?<!\p{L})diagnosti(?:c|cs|que|quer|quons|quez|qué|quée|qués)(?!\p{L})/giu },
  {
    id: 'fr.traiter',
    locale: 'fr',
    category: 'medical',
    description: 'traiter / traitement + douleur, maladie, blessure…',
    pattern: /(?<!\p{L})trait(?:e|es|er|ez|ons|ent|ement|ements)(?!\p{L})[^.!?\n]{0,40}(?<!\p{L})(?:douleurs?|maladies?|blessures?|symptômes?|pathologies?|mal de dos|tendinites?|arthrose|diabète|obésité|hypertension)(?!\p{L})/giu,
  },
  { id: 'fr.guerir', locale: 'fr', category: 'medical', description: 'guérir / guérison', pattern: /(?<!\p{L})guéri(?:r|t|s|ssez|ssent|son|sons)?(?!\p{L})/giu },
  { id: 'fr.soigner', locale: 'fr', category: 'medical', description: 'soigner', pattern: /(?<!\p{L})soign(?:e|es|er|ez|ons|ent)(?!\p{L})/giu },
  {
    id: 'fr.prevenir_maladie',
    locale: 'fr',
    category: 'medical',
    description: 'prévenir / prévention + maladie, blessure…',
    pattern: /(?<!\p{L})pr[ée]v(?:enir|ient|iennent|enez|ention)(?!\p{L})[^.!?\n]{0,40}(?<!\p{L})(?:maladies?|blessures?|pathologies?|diabète|cancer|infarctus)(?!\p{L})/giu,
  },
  { id: 'fr.cliniquement_prouve', locale: 'fr', category: 'medical', description: 'cliniquement / médicalement prouvé', pattern: /(?<!\p{L})(?:cliniquement|médicalement|scientifiquement) (?:prouvée?s?|démontrée?s?)(?!\p{L})/giu },
  { id: 'fr.garanti', locale: 'fr', category: 'results', description: 'garanti / garantir (résultats)', pattern: /(?<!\p{L})garant(?:i|ie|is|ies|ir|issons|issez|it|issent)(?!\p{L})/giu },
  {
    id: 'fr.perdre_x_en_y',
    locale: 'fr',
    category: 'results',
    description: 'perdre N kg en N jours/semaines',
    pattern: /(?<!\p{L})perd(?:re|ez|ez)?\s{1,3}\d{1,3}\s{0,2}(?:kg|kilos?)(?!\p{L})[^.!?\n]{0,20}(?<!\p{L})en\s{1,3}\d{1,3}\s{0,2}(?:jours?|semaines?)(?!\p{L})/giu,
  },
  {
    id: 'fr.bruler_graisses',
    locale: 'fr',
    category: 'fat_loss',
    description: 'brûler les graisses (vite) / brûle-graisse / zone de combustion des graisses',
    pattern: /(?<!\p{L})(?:brûl(?:e|er|ez|ent)\s{1,3}(?:les\s|la\s|vos\s|du\s)?(?:graisses?|gras)|brûle-graisses?|zone\s{1,3}de\s{1,3}(?:combustion|brûlage)\s{1,3}des\s{1,3}graisses)(?!\p{L})/giu,
  },
  // M03 (C9): pas d'allégation de lipolyse ni de « zone de perte de graisse ».
  { id: 'fr.lipolyse', locale: 'fr', category: 'fat_loss', description: 'lipolyse / lipolytique (ex. « lipolyse maximale »)', pattern: /(?<!\p{L})lipoly(?:se|ses|tique|tiques)(?!\p{L})/giu },
  {
    id: 'fr.zone_graisses',
    locale: 'fr',
    category: 'fat_loss',
    description: 'zone de perte / de fonte / d’oxydation des graisses',
    pattern: /(?<!\p{L})zones?\s{1,3}(?:de|d’|d')\s{0,3}(?:perte|fonte|oxydation)\s{1,3}(?:des|de|du)\s{1,3}(?:graisses?|gras)(?!\p{L})/giu,
  },
  { id: 'fr.fondre', locale: 'fr', category: 'fat_loss', description: 'faire fondre les graisses / kilos', pattern: /(?<!\p{L})fond(?:re|ez)\s{1,3}(?:les\s|la\s|vos\s)?(?:graisses?|gras|kilos)(?!\p{L})/giu },
  { id: 'fr.maigrir_vite', locale: 'fr', category: 'results', description: 'maigrir vite / rapidement', pattern: /(?<!\p{L})maigri(?:r|ssez)\s{1,3}(?:vite|rapidement)(?!\p{L})/giu },
  // FIX-B: additions from the AI pre-reviews (A4-A6 M10-25, B §3.6).
  { id: 'fr.booster_metabolisme', locale: 'fr', category: 'fat_loss', description: 'booster le métabolisme', pattern: /(?<!\p{L})boost(?:er|ez|e|ent)\s{1,3}(?:le\s|votre\s|ton\s)?métabolisme(?!\p{L})/giu },
  { id: 'fr.detox', locale: 'fr', category: 'medical', description: 'détox / éliminer les toxines', pattern: /(?<!\p{L})(?:d[ée]tox(?:ifier|ifiant|ifiante|ification)?|toxines?)(?!\p{L})/giu },
  { id: 'fr.reeducation', locale: 'fr', category: 'medical', description: 'rééducation (de blessure)', pattern: /(?<!\p{L})r[ée][ée]duca(?:tion|tions|tif|tive)(?!\p{L})/giu },
] satisfies DenyRule[]);

export interface SubstantiationEntry {
  readonly id: string;
  /** Exact phrase (case-insensitive) that may appear although it matches a deny rule. */
  readonly phrase: string;
  readonly locale: ClaimLocale | 'any';
  /** claim: a positive statement with evidence; disclaimer: a negative wellness-positioning statement. */
  readonly kind: 'claim' | 'disclaimer';
  readonly evidence: string;
  readonly scope: string;
  /** Counsel review status; always 'pending' until counsel signs (never set by engineering). */
  readonly review: string;
}

export interface ClaimFinding {
  readonly source: string;
  readonly key: string | null;
  readonly locale: ClaimLocale | 'any';
  readonly ruleId: string;
  readonly category: ClaimCategory;
  readonly match: string;
}

const normalise = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u00a0\u202f]/g, ' ').toLowerCase();

/** Replaces substantiated phrases by spaces so deny rules cannot match inside them. */
function mask(text: string, entries: readonly SubstantiationEntry[], locale: ClaimLocale | 'any'): string {
  let out = text;
  for (const e of entries) {
    if (!e.evidence.trim() || (e.locale !== 'any' && locale !== 'any' && e.locale !== locale)) continue;
    const phrase = normalise(e.phrase);
    if (!phrase) continue;
    let from = 0;
    for (let at = out.indexOf(phrase, from); at !== -1; at = out.indexOf(phrase, from)) {
      out = out.slice(0, at) + ' '.repeat(phrase.length) + out.slice(at + phrase.length);
      from = at + phrase.length;
    }
  }
  return out;
}

export interface LintTarget {
  readonly source: string;
  readonly key?: string | null;
  /** 'any' applies the rules of both languages (prompts, eval outputs, unknown files). */
  readonly locale: ClaimLocale | 'any';
  readonly text: string;
}

export function lintClaims(targets: readonly LintTarget[], substantiation: readonly SubstantiationEntry[] = [], rules: readonly DenyRule[] = CLAIM_DENYLIST): ClaimFinding[] {
  const findings: ClaimFinding[] = [];
  for (const t of targets) {
    const text = mask(normalise(t.text), substantiation, t.locale);
    for (const rule of rules) {
      if (t.locale !== 'any' && rule.locale !== t.locale) continue;
      for (const m of text.matchAll(rule.pattern)) {
        findings.push({ source: t.source, key: t.key ?? null, locale: t.locale, ruleId: rule.id, category: rule.category, match: m[0] });
      }
    }
  }
  return findings;
}

export function catalogueTargets(source: string, locale: ClaimLocale, catalogue: Readonly<Record<string, string>>): LintTarget[] {
  return Object.entries(catalogue).map(([key, text]) => ({ source, key, locale, text }));
}

/** Problems in the substantiation file itself: every entry needs an id, a phrase, evidence and a review status. */
export function validateSubstantiation(entries: readonly SubstantiationEntry[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const e of entries) {
    const label = e.id || '(no id)';
    if (!e.id) problems.push(`${label}: missing id`);
    else if (ids.has(e.id)) problems.push(`${label}: duplicate id`);
    ids.add(e.id);
    if (!e.phrase.trim()) problems.push(`${label}: missing phrase`);
    if (!e.evidence.trim()) problems.push(`${label}: missing evidence (an entry without evidence does not allow anything)`);
    if (!['claim', 'disclaimer'].includes(e.kind)) problems.push(`${label}: kind must be claim or disclaimer`);
    if (!['en', 'fr', 'any'].includes(e.locale)) problems.push(`${label}: locale must be en, fr or any`);
    if (/approved|signed|final/i.test(e.review)) problems.push(`${label}: review status "${e.review}" — only counsel can approve (L5); use "pending"`);
  }
  return problems;
}

/** L7: the codename must not appear in store metadata or public assets. */
export const CODENAME_PATTERN = /fit[\s._-]{0,2}adapt/giu;

export function findCodename(text: string): string[] {
  return [...text.matchAll(CODENAME_PATTERN)].map((m) => m[0]);
}
