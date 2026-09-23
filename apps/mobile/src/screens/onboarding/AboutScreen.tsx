import { useI18n } from '@fitadapt/i18n/react';
import { cmToIn, inToCm, kgToLb, lbToKg } from '@fitadapt/i18n';
import { isValidCalendarDate } from '@fitadapt/safety';
import { BiometricsSchema, JOINTS, PROFILE_INPUT_BOUNDS, type Biometrics, type CalendarDateValue } from '@fitadapt/shared';
import { Button, Chip, Input, useTheme } from '@fitadapt/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { clock } from '../../clock';
import { OnboardingScaffold, Paragraph, SectionTitle } from '../../onboarding/OnboardingScaffold';
import { nextPath } from '../../onboarding/steps';
import { localToday } from '../../privacy/age-gate';
import { useAgeGate } from '../../privacy/PrivacyProvider';
import { useLegal, useProfile } from '../../profile/ProfileProvider';

const toInt = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
/** Empty → null (skipped); otherwise a number with either decimal separator, or NaN. */
const toNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const [whole = '', fraction, extra] = trimmed.split('.');
  const digits = (part: string, max: number) => part.length >= 1 && part.length <= max && [...part].every((c) => c >= '0' && c <= '9');
  const ok = extra === undefined && digits(whole, 4) && (fraction === undefined || digits(fraction, 2));
  return ok ? Number(trimmed) : Number.NaN;
};
const shown = (value: number | null, convert: (n: number) => number) => (value === null ? '' : String(Math.round(convert(value) * 10) / 10));
const compare = (a: CalendarDateValue, b: CalendarDateValue) => a.year - b.year || a.month - b.month || a.day - b.day;

/**
 * Step 6: date of birth (kept for age-based safety rules), optional body
 * measurements (never required, neutral wording), body areas to go easy on,
 * and a one-line motivation. The S7 age gate runs again on this date.
 */
export function AboutScreen() {
  const { t, unitSystem } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const draft = useProfile((s) => s.draft);
  const update = useProfile((s) => s.updateDraft);
  const saveProfile = useProfile((s) => s.saveProfileFromDraft);
  const submitAge = useAgeGate((s) => s.submit);
  const jurisdiction = useLegal((s) => s.jurisdiction);
  const imperial = unitSystem === 'imperial';
  const unit = (key: 'units.cm' | 'units.in' | 'units.kg' | 'units.lb') => t(key, { value: '' }).trim();

  const [day, setDay] = useState(draft.birthDate ? String(draft.birthDate.day) : '');
  const [month, setMonth] = useState(draft.birthDate ? String(draft.birthDate.month) : '');
  const [year, setYear] = useState(draft.birthDate ? String(draft.birthDate.year) : '');
  const [height, setHeight] = useState(shown(draft.biometrics.heightCm, imperial ? cmToIn : (n) => n));
  const [weight, setWeight] = useState(shown(draft.biometrics.weightKg, imperial ? kgToLb : (n) => n));
  const [bodyFat, setBodyFat] = useState(shown(draft.biometrics.bodyFatPercent, (n) => n));
  const [motivation, setMotivation] = useState(draft.motivation);
  const [dateError, setDateError] = useState(false);
  const [numberError, setNumberError] = useState<'height' | 'weight' | 'bodyFat' | null>(null);

  const proceed = (biometrics: Biometrics) => {
    const birthDate = { year: toInt(year), month: toInt(month), day: toInt(day) };
    const today = localToday(clock.now());
    if (!isValidCalendarDate(birthDate) || compare(birthDate, today) > 0) return setDateError(true);
    setDateError(false);
    update({ birthDate, biometrics, motivation: motivation.slice(0, PROFILE_INPUT_BOUNDS.motivationMaxLength.value) });
    // S7: the stored date of birth goes through the same age gate; a block locks the app.
    if (submitAge(birthDate, today, jurisdiction).status !== 'allowed') return;
    saveProfile();
    router.push(nextPath('about'));
  };

  const onContinue = () => {
    const h = toNumber(height);
    const w = toNumber(weight);
    const f = toNumber(bodyFat);
    const biometrics = {
      heightCm: h === null ? null : imperial ? inToCm(h) : h,
      weightKg: w === null ? null : imperial ? lbToKg(w) : w,
      bodyFatPercent: f,
    };
    const parsed = BiometricsSchema.safeParse(biometrics);
    if (!parsed.success || [h, w, f].some((n) => Number.isNaN(n))) {
      const field = Number.isNaN(h) || parsed.error?.issues.some((i) => i.path[0] === 'heightCm') ? 'height' : Number.isNaN(w) || parsed.error?.issues.some((i) => i.path[0] === 'weightKg') ? 'weight' : 'bodyFat';
      return setNumberError(field);
    }
    setNumberError(null);
    proceed(parsed.data);
  };

  const onSkipMeasurements = () => {
    setHeight('');
    setWeight('');
    setBodyFat('');
    setNumberError(null);
    proceed({ heightCm: null, weightKg: null, bodyFatPercent: null });
  };

  const invalid = t('onboarding.about.invalidNumber');
  return (
    <OnboardingScaffold step="about" title={t('onboarding.about.title')} onNext={onContinue}>
      <SectionTitle>{t('onboarding.about.birthDate')}</SectionTitle>
      <Paragraph muted>{t('onboarding.about.birthDateWhy')}</Paragraph>
      <Input label={t('ageGate.day')} hint={t('ageGate.dayHint')} value={day} onChangeText={setDay} keyboardType="number-pad" testID="about-birth-day" />
      <Input label={t('ageGate.month')} hint={t('ageGate.monthHint')} value={month} onChangeText={setMonth} keyboardType="number-pad" testID="about-birth-month" />
      <Input
        label={t('ageGate.year')}
        hint={t('ageGate.yearHint')}
        value={year}
        onChangeText={setYear}
        keyboardType="number-pad"
        error={dateError ? t('onboarding.about.birthDateInvalid') : undefined}
        testID="about-birth-year"
      />

      <SectionTitle>{t('onboarding.about.biometrics')}</SectionTitle>
      <Paragraph muted>{t('onboarding.about.biometricsIntro')}</Paragraph>
      <Input label={t('onboarding.about.height')} hint={t('onboarding.about.unitHint', { unit: unit(imperial ? 'units.in' : 'units.cm') })} value={height} onChangeText={setHeight} keyboardType="decimal-pad" error={numberError === 'height' ? invalid : undefined} testID="about-height" />
      <Input label={t('onboarding.about.weight')} hint={t('onboarding.about.unitHint', { unit: unit(imperial ? 'units.lb' : 'units.kg') })} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" error={numberError === 'weight' ? invalid : undefined} testID="about-weight" />
      <Input label={t('onboarding.about.bodyFat')} hint={t('onboarding.about.unitHint', { unit: '%' })} value={bodyFat} onChangeText={setBodyFat} keyboardType="decimal-pad" error={numberError === 'bodyFat' ? invalid : undefined} testID="about-body-fat" />
      <Button label={t('onboarding.about.skipMeasurements')} hint={t('onboarding.skipHint')} variant="secondary" onPress={onSkipMeasurements} testID="about-skip-measurements" />

      <SectionTitle>{t('onboarding.about.limitations')}</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {JOINTS.map((joint) => {
          const selected = draft.limitations.includes(joint);
          return (
            <Chip
              key={joint}
              label={t(`library.joint.${joint}`)}
              hint={t('onboarding.about.limitationHint')}
              selected={selected}
              onPress={() => update({ limitations: selected ? draft.limitations.filter((j) => j !== joint) : JOINTS.filter((j) => j === joint || draft.limitations.includes(j)) })}
              testID={`limitation-${joint}`}
            />
          );
        })}
      </View>
      <Input label={t('onboarding.about.motivation')} hint={t('onboarding.about.motivationHint')} value={motivation} onChangeText={setMotivation} testID="about-motivation" />
    </OnboardingScaffold>
  );
}
