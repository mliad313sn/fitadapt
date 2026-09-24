import { describe, expect, it } from 'vitest';
import { recoveryMedicalEn } from './catalogues/recovery-medical.en.js';
import { recoveryMedicalFr } from './catalogues/recovery-medical.fr.js';
import { recoveryEn } from './catalogues/recovery.en.js';
import { createTranslator, en, fr, guiltPhrases, MEDICAL_REVIEW } from './index.js';

/** M05 wording: FR and EN, no guilt, no diagnostic wording; the health-related copy is flagged for physician review. */
describe('M05 recovery copy', () => {
  it('every M05 message exists in both languages and renders', () => {
    for (const key of [...Object.keys(recoveryEn), ...Object.keys(recoveryMedicalEn)] as (keyof typeof en)[]) {
      expect(en[key], key).toBeTruthy();
      expect(fr[key], key).toBeTruthy();
    }
    expect(createTranslator('fr').t('recovery.warmup.rampSet', { reps: 8, load: '20 kg' })).toBe('8 répétitions avec 20 kg');
    expect(createTranslator('en').t('recovery.physio.body.knee')).toContain('physiotherapist');
  });

  it('the health-related copy lives in its own content file, flagged for physician review (A1, A2, counsel)', () => {
    expect(MEDICAL_REVIEW).toMatchObject({ status: 'requires physician review', seats: ['A1', 'A2'], counsel: true });
    expect(MEDICAL_REVIEW.keys).toEqual(Object.keys(recoveryMedicalEn));
    expect(Object.keys(recoveryMedicalFr).sort()).toEqual(Object.keys(recoveryMedicalEn).sort());
    // Pain checks, the physiotherapist suggestion, amber-joint tips, the red-flag check-in and the review statement are all in it.
    for (const prefix of ['recovery.pain.', 'recovery.physio.', 'engine.reason.session.amber.', 'recovery.redFlag.', 'recovery.s3.']) {
      expect(MEDICAL_REVIEW.keys.some((k) => k.startsWith(prefix)), prefix).toBe(true);
      expect(Object.keys(recoveryEn).some((k) => k.startsWith(prefix)), `${prefix} outside the flagged file`).toBe(false);
    }
  });

  it('no guilt or pressure, no diagnostic wording, in English and in French', () => {
    const keys = [...Object.keys(recoveryEn), ...Object.keys(recoveryMedicalEn)] as (keyof typeof en)[];
    const diagnostic = /diagnos|you have (a|an) |injur|tendin|arthrit|vous avez une? |blessure|tendinite|arthrose/i;
    for (const key of keys) {
      expect({ key, hits: guiltPhrases(en[key], 'en') }).toEqual({ key, hits: [] });
      expect({ key, hits: guiltPhrases(fr[key], 'fr') }).toEqual({ key, hits: [] });
      expect({ key, en: diagnostic.test(en[key]), fr: diagnostic.test(fr[key]) }).toEqual({ key, en: false, fr: false });
    }
  });
});
