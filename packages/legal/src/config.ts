import { defineConfig, unvalidatedKeys } from '@fitadapt/shared';

/**
 * M20 numeric parameters (CLAUDE.md rule 4). None is validated: each needs
 * counsel (seat B2 for consumer and product-liability law, B1 for privacy).
 * Listed in docs/status/M20.md.
 */
const ENGINEERING = 'engineering default, no external source; to be set by counsel (docs/legal/counsel-signoff-tracker.md)';

export const legalConfig = defineConfig({
  /**
   * Minimum days between publishing a material change of a document that
   * needs advance notice (Terms, Subscription Terms, Privacy Policy) and the
   * date it takes effect.
   */
  materialChangeNoticeDays: { value: 30, unit: 'days', source: ENGINEERING, validated: false },
  /**
   * Defensibility log retention, counted from the last event of a subject.
   * Chosen to cover a 10-year product-liability long-stop period; the period
   * and its start are for counsel to confirm per jurisdiction.
   */
  defensibilityRetentionDays: {
    value: 3650,
    unit: 'days (10 years)',
    source: 'drafting-assistant reading of the 10-year long-stop in Council Directive 85/374/EEC Art. 11 (unverified); docs/legal/defensibility-file.md',
    validated: false,
  },
  /** KPI target for producing a legal-hold export (M20 spec, KPIs: "< 1 day"). */
  legalHoldExportTargetHours: { value: 24, unit: 'hours', source: 'docs/specs/M20-legal-framework-defensibility.md, KPIs', validated: false },
});

export type LegalConfigKey = keyof typeof legalConfig;
export const legalValue = (key: LegalConfigKey): number => legalConfig[key].value;
export const LEGAL_UNVALIDATED = unvalidatedKeys(legalConfig);
