import { UNKNOWN_JURISDICTION, defineConfig, type ConfigValue, type Jurisdiction } from '@fitadapt/shared';
import { AGE_GATE_MINIMUM_YEARS } from '@fitadapt/safety';

/**
 * Jurisdiction matrix as configuration (M20 scope). A STARTING CHECKLIST FOR
 * COUNSEL, not a statement of the law: every row requires counsel review
 * (docs/legal/jurisdiction-matrix.md mirrors this file and a test keeps them
 * in sync). Numbers carry `source` and `validated` (CLAUDE.md rule 4); none is
 * validated. Launch markets are not confirmed (Gate 0), so no market is
 * "launched" here.
 */

/** Which text variant of a legal document applies (governing law, authority, withdrawal wording). */
export const DOCUMENT_VARIANTS = ['EU_FR', 'GB', 'US', 'SN', 'CI', 'DEFAULT'] as const;
export type DocumentVariant = (typeof DOCUMENT_VARIANTS)[number];

export type FilingStatus = 'open';
export interface AuthorityFiling {
  readonly authority: string;
  readonly item: string;
  /** Gate 0 items are done by a human with counsel; every one starts (and stays here) 'open'. */
  readonly status: FilingStatus;
}

export type WithdrawalRule = 'statutory_period' | 'no_general_statutory_right' | 'to_confirm';

export interface JurisdictionProfile {
  readonly code: Jurisdiction;
  /** Internal label for counsel and engineers (not user-facing). */
  readonly label: string;
  readonly variant: DocumentVariant;
  readonly frameworks: readonly string[];
  readonly ages: {
    /** Minimum age to use the product. Can only raise the S7 floor of 16. */
    readonly minimumAge: ConfigValue;
    /** Age from which data-protection consent can be given without a parent (null: no known rule). */
    readonly digitalConsentAge: ConfigValue | null;
    /** Age of majority: below it, a purchase needs a parent or guardian. */
    readonly ageOfMajority: ConfigValue;
  };
  readonly withdrawal: { readonly rule: WithdrawalRule; readonly periodDays: ConfigValue | null; readonly digitalContentWaiver: boolean };
  /**
   * Emergency guidance shown with the S3 stop notices. `number`: the general emergency number, null until
   * confirmed (the generic line is shown instead). `medical` (FIX-B, CS-6): the medical-emergency (SAMU)
   * number(s), shown before the general number — every one validated:false until local counsel and seat A1
   * confirm; where no general number is confirmed, the generic line is shown with them.
   */
  readonly emergency: { readonly number: string | null; readonly source: string; readonly medical?: EmergencyMedical };
  readonly authorityFilings: readonly AuthorityFiling[];
}

export interface EmergencyMedical {
  readonly numbers: readonly string[];
  readonly source: string;
  /** Never true here: a number is confirmed only by a counsel and seat A1 sign-off record. */
  readonly validated: false;
}

const FLOOR_SOURCE = 'S7 floor (docs/specs/00-product-vision.md); no higher local minimum known to the drafting assistant';
const UNVERIFIED = '(drafting-assistant knowledge, unverified)';

const age = (value: number, source: string) => ({ value, unit: 'years', source, validated: false });
const days = (value: number, source: string) => ({ value, unit: 'days', source, validated: false });

function profile(p: JurisdictionProfile): JurisdictionProfile {
  const values: Record<string, ConfigValue> = { minimumAge: p.ages.minimumAge, ageOfMajority: p.ages.ageOfMajority };
  if (p.ages.digitalConsentAge) values.digitalConsentAge = p.ages.digitalConsentAge;
  const ages = defineConfig(values);
  if (ages.minimumAge!.value < AGE_GATE_MINIMUM_YEARS) throw new Error(`${p.code}: minimumAge below the S7 floor`);
  if (p.withdrawal.periodDays) defineConfig({ periodDays: p.withdrawal.periodDays });
  return Object.freeze(p);
}

export const JURISDICTION_MATRIX: Readonly<Record<string, JurisdictionProfile>> = Object.freeze({
  FR: profile({
    code: 'FR',
    label: 'EU (France)',
    variant: 'EU_FR',
    frameworks: [
      'GDPR (health data: Art. 9)',
      'EU AI Act Art. 50 transparency (since 2 Aug 2026)',
      'EU MDR boundary (no medical purpose)',
      'Consumer Rights Directive (withdrawal)',
      'Unfair Commercial Practices Directive',
      'Digital Services Act (user content)',
      'European Accessibility Act',
      'French-language requirements for consumer documents',
    ],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: age(15, `French Data Protection Act, Art. 45 (GDPR Art. 8 option) ${UNVERIFIED}`),
      ageOfMajority: age(18, `French Civil Code, Art. 414 ${UNVERIFIED}`),
    },
    withdrawal: { rule: 'statutory_period', periodDays: days(14, `Directive 2011/83/EU Art. 9 ${UNVERIFIED}`), digitalContentWaiver: true },
    emergency: {
      number: '112',
      source: `EU single emergency number ${UNVERIFIED}`,
      medical: {
        numbers: ['15'],
        source: 'SAMU (medical emergencies) beside 112, from docs/governance/ai-reviews/A1-A2-clinical-safety.md (M05-22): FFTélécoms and Ministère de l’Intérieur pages, search summaries only. AI pre-review, not a sign-off; requires seat A1 and counsel review.',
        validated: false,
      },
    },
    authorityFilings: [
      { authority: 'CNIL', item: 'Confirm whether any prior formality applies to health data processing; DPIA on file (docs/compliance/dpia.md)', status: 'open' },
      { authority: 'Hosting', item: 'Confirm whether health-data hosting certification (HDS) is required for the chosen host', status: 'open' },
      { authority: 'EU representative', item: 'Appoint a GDPR Art. 27 representative if the company is established outside the EU', status: 'open' },
    ],
  }),
  GB: profile({
    code: 'GB',
    label: 'United Kingdom',
    variant: 'GB',
    frameworks: ['UK GDPR and Data Protection Act 2018', 'Consumer protection and subscription-contract rules (DMCC Act 2024, as in force)', 'UK medical-device rules for any medical purpose'],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: age(13, `Data Protection Act 2018, s. 9 ${UNVERIFIED}`),
      ageOfMajority: age(18, `Family Law Reform Act 1969 ${UNVERIFIED}`),
    },
    withdrawal: { rule: 'statutory_period', periodDays: days(14, `Consumer Contracts Regulations 2013 ${UNVERIFIED}`), digitalContentWaiver: true },
    emergency: { number: '999', source: `UK emergency number ${UNVERIFIED}` },
    authorityFilings: [
      { authority: 'ICO', item: 'Pay the data protection fee', status: 'open' },
      { authority: 'UK representative', item: 'Appoint a UK GDPR Art. 27 representative if established outside the UK', status: 'open' },
    ],
  }),
  US: profile({
    code: 'US',
    label: 'United States',
    variant: 'US',
    frameworks: [
      'FTC Act (deceptive claims)',
      'FTC Health Breach Notification Rule',
      'State consumer-health-data laws (e.g. Washington My Health My Data Act)',
      'State auto-renewal laws',
      'Illinois BIPA if any biometric identifiers',
      'COPPA (users under 13 excluded anyway)',
      'FDA general-wellness policy',
    ],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: age(13, `COPPA (under-13 rule) ${UNVERIFIED}`),
      ageOfMajority: age(21, `varies by state (18 in most, higher in a few) ${UNVERIFIED}; highest value used until state rules are configured`),
    },
    withdrawal: { rule: 'no_general_statutory_right', periodDays: null, digitalContentWaiver: false },
    emergency: { number: '911', source: `US emergency number ${UNVERIFIED}` },
    authorityFilings: [{ authority: 'States', item: 'Check state consumer-health-data law registrations and notices before any US launch', status: 'open' }],
  }),
  SN: profile({
    code: 'SN',
    label: 'Senegal',
    variant: 'SN',
    frameworks: [
      'Law No. 2008-12 on personal data (confirm the text in force) and prior formalities with the CDP',
      'Law No. 2008-08 on electronic transactions',
      'Consumer-protection rules',
    ],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: null,
      ageOfMajority: age(18, `Senegalese Family Code ${UNVERIFIED}`),
    },
    withdrawal: { rule: 'to_confirm', periodDays: null, digitalContentWaiver: false },
    emergency: {
      number: null,
      source: 'general number to be confirmed by local counsel before display (generic guidance shown)',
      medical: {
        numbers: ['1515', '15'],
        source: 'SAMU national, from docs/governance/ai-reviews/A1-A2-clinical-safety.md (M05-22) and docs/governance/ai-reviews/B-legal-regulatory.md (seek_care row): Ministère de la Santé du Sénégal page and French embassy page, secondary sources and search summaries only — NOT verified from an official gazette. Pending local counsel and seat A1; the generic guidance is shown with it.',
        validated: false,
      },
    },
    authorityFilings: [
      { authority: 'CDP', item: 'Prior declaration or authorisation for health data processing and transfers abroad (Law No. 2008-12)', status: 'open' },
    ],
  }),
  CI: profile({
    code: 'CI',
    label: "Côte d'Ivoire",
    variant: 'CI',
    frameworks: ['Law No. 2013-450 on personal data (supervised by ARTCI)', 'Local consumer and e-commerce rules', 'Language requirements'],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: null,
      ageOfMajority: age(21, `no verified source; conservative value pending counsel ${UNVERIFIED}`),
    },
    withdrawal: { rule: 'to_confirm', periodDays: null, digitalContentWaiver: false },
    emergency: {
      number: null,
      source: 'general number to be confirmed by local counsel before display (generic guidance shown)',
      medical: {
        numbers: ['185'],
        source: 'SAMU, from docs/governance/ai-reviews/A1-A2-clinical-safety.md (M05-22) and docs/governance/ai-reviews/B-legal-regulatory.md (seek_care row): secondary sources (list of emergency numbers, pharmacies-de-garde.ci), search summaries only — NOT verified from an official source. Pending local counsel and seat A1; the generic guidance is shown with it.',
        validated: false,
      },
    },
    authorityFilings: [{ authority: 'ARTCI', item: 'Declaration or authorisation for health data processing (Law No. 2013-450)', status: 'open' }],
  }),
  [UNKNOWN_JURISDICTION]: profile({
    code: UNKNOWN_JURISDICTION,
    label: 'Unknown or other market (strictest defaults)',
    variant: 'DEFAULT',
    frameworks: ['App store policies (Apple App Review Guidelines, Google Play Health apps policy, data-safety form, payments)'],
    ages: {
      minimumAge: age(16, FLOOR_SOURCE),
      digitalConsentAge: age(16, 'GDPR Art. 8 default (highest option), used as the strictest default'),
      ageOfMajority: age(21, 'conservative default for unknown markets (no source)'),
    },
    withdrawal: { rule: 'statutory_period', periodDays: days(14, 'strictest default: same period as the EU (engineering choice)'), digitalContentWaiver: true },
    emergency: { number: null, source: 'unknown market: generic guidance' },
    authorityFilings: [],
  }),
});

/** The profile for a jurisdiction; unknown or unlisted countries get the strictest defaults ("ZZ"). */
export function jurisdictionProfile(code: string | null | undefined, matrix = JURISDICTION_MATRIX): JurisdictionProfile {
  const key = (code ?? '').toUpperCase();
  return matrix[key] ?? matrix[UNKNOWN_JURISDICTION]!;
}

export const variantFor = (code: string | null | undefined, matrix = JURISDICTION_MATRIX): DocumentVariant => jurisdictionProfile(code, matrix).variant;

/** Every config value in the matrix, for status files and launch checks. */
export function matrixConfigValues(matrix = JURISDICTION_MATRIX): { path: string; value: ConfigValue }[] {
  const out: { path: string; value: ConfigValue }[] = [];
  for (const p of Object.values(matrix)) {
    for (const [k, v] of Object.entries(p.ages)) if (v) out.push({ path: `${p.code}.ages.${k}`, value: v });
    if (p.withdrawal.periodDays) out.push({ path: `${p.code}.withdrawal.periodDays`, value: p.withdrawal.periodDays });
  }
  return out;
}
