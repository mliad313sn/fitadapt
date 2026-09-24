import { useI18n } from '@fitadapt/i18n/react';
import { acceptanceState, evaluateEligibility, type LegalDocumentId } from '@fitadapt/legal';
import { SCREENING_CONFIG, SCREENING_QUESTIONS, SCREENING_RULES } from '@fitadapt/safety';
import { PAIR_SHARING_SCOPES, type PairSharingScope, type ScreeningAnswer } from '@fitadapt/shared';
import { consentState } from '@fitadapt/privacy';
import { Button, Card, ChoiceGroup, Input, Toggle, useTheme } from '@fitadapt/ui';
import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { useStore } from 'zustand';
import { clock } from '../clock';
import { DocumentView } from '../legal/DocumentView';
import { currentLegalRegistry } from '../legal/registry';
import { localToday } from '../privacy/age-gate';
import { guestWorkoutGate, sharedScopes, type GuestLedgers } from './pair-store';
import { usePair, usePairStore } from './PairProvider';

const MONTHS_PARAM: Partial<Record<(typeof SCREENING_QUESTIONS)[number], number>> = {
  chest_discomfort: SCREENING_CONFIG.symptomLookbackMonths.value,
  fainting_or_dizziness: SCREENING_CONFIG.symptomLookbackMonths.value,
  pregnancy_or_recent_birth: SCREENING_CONFIG.postpartumWindowMonths.value,
};

/** One L2 text in the guest's OWN ledger: read it, then "I accept" (informed acceptance). */
function GuestAcceptance({ ledgers, documentId }: { ledgers: GuestLedgers; documentId: 'terms' | 'privacy' | 'exercise_risk' }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const acceptances = useStore(ledgers.legal, (s) => s.acceptances);
  const jurisdiction = useStore(ledgers.legal, (s) => s.jurisdiction);
  const [open, setOpen] = useState(false);
  const document = ledgers.legal.getState().render(documentId, locale);
  const accepted = acceptanceState(acceptances, documentId, { jurisdiction, now: clock.now(), registry: currentLegalRegistry() }).status === 'accepted';
  return (
    <Card title={document.title} testID={`pair-guest-legal-${documentId}`}>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }} testID={`pair-guest-legal-${documentId}-status`}>
        {accepted ? t('pair.guest.accepted') : t('legal.status.needsAcceptance')}
      </Text>
      <Button label={open ? t('onboarding.terms.hide') : t('legal.action.readFull')} variant="secondary" onPress={() => setOpen(!open)} testID={`pair-guest-legal-${documentId}-read`} />
      {open ? <DocumentView document={document} showTitle={false} testID={`pair-guest-legal-${documentId}-text`} /> : null}
      {open && !accepted ? <Button label={t('legal.action.accept')} hint={t('legal.action.acceptHint')} onPress={() => ledgers.legal.getState().accept(documentId, locale)} testID={`pair-guest-legal-${documentId}-accept`} /> : null}
    </Card>
  );
}

/** A consent in the guest's OWN M17 ledger (health data, partner sharing), after its text. */
function GuestConsent({ ledgers, dataType }: { ledgers: GuestLedgers; dataType: 'health' | 'partner_sharing' }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const records = useStore(ledgers.consents, (s) => s.records);
  const document = ledgers.legal.getState().render(`consent.${dataType}` as LegalDocumentId, locale);
  const granted = [...records].reverse().find((r) => r.dataType === dataType)?.decision === 'granted';
  return (
    <Card title={document.title} testID={`pair-guest-consent-${dataType}`}>
      <DocumentView document={document} showTitle={false} />
      {granted ? (
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('pair.guest.consented')}</Text>
      ) : (
        <Button
          label={t('pair.consent.agree')}
          hint={t('pair.consent.agreeHint')}
          onPress={() => {
            const record = ledgers.consents.getState().decide(dataType, true, locale);
            ledgers.legal.getState().logConsent(record);
          }}
          testID={`pair-guest-consent-${dataType}-agree`}
        />
      )}
    </Card>
  );
}

/** The scopes a person shares with their partner (off by default; body weight and the challenge need their own choice). */
export function SharingChoices({ name, value, onChange, testPrefix }: { name: string; value: readonly PairSharingScope[]; onChange: (scopes: PairSharingScope[]) => void; testPrefix: string }) {
  const { t } = useI18n();
  return (
    <View>
      <Text accessibilityRole="header" style={{ fontWeight: '700' }}>
        {t('pair.sharing.title', { name })}
      </Text>
      {PAIR_SHARING_SCOPES.map((scope) => (
        <Toggle
          key={scope}
          label={t(`pair.sharing.${scope}.label`)}
          description={t(`pair.sharing.${scope}.description`)}
          value={value.includes(scope)}
          onValueChange={(on) => onChange(on ? [...value, scope] : value.filter((s) => s !== scope))}
          testID={`${testPrefix}-sharing-${scope}`}
        />
      ))}
    </View>
  );
}

type Step = 'legal' | 'screening' | 'sharing';

/**
 * A partner who uses the owner's phone answers for themselves (L2, M17,
 * M20): their own date of birth (the S7 / M17 age gate and the jurisdiction's
 * ages), their own Terms, Privacy Policy and exercise-risk acknowledgment,
 * their own health-data and partner-sharing consents, their own health
 * questions, and their own sharing choices. Everything goes to their own
 * ledgers on this phone, never the owner's.
 */
export function PartnerSetup({ guestId, onDone, onCancel }: { guestId: string | null; onDone: (guestId: string) => void; onCancel: () => void }) {
  const [id, setId] = useState<string | null>(guestId);
  if (!id) return <GuestIdentity onCreated={setId} onCancel={onCancel} />;
  return <GuestSteps key={id} id={id} onDone={onDone} onCancel={onCancel} />;
}

function Scaffold({ step, title, error, next, nextLabel, onCancel, children }: { step: string; title: string; error: string | null; next: () => void; nextLabel?: string; onCancel: () => void; children?: ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.lg }} testID={`pair-guest-${step}`}>
      <Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: theme.fontSize.title, fontWeight: theme.fontWeight.bold }}>
        {title}
      </Text>
      {children}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: theme.fontSize.label }} testID="pair-guest-error">
          {error}
        </Text>
      ) : null}
      <Button label={nextLabel ?? t('pair.guest.continue')} onPress={next} testID="pair-guest-next" />
      <Button label={t('pair.guest.cancel')} variant="secondary" onPress={onCancel} testID="pair-guest-cancel" />
    </View>
  );
}

function GuestIdentity({ onCreated, onCancel }: { onCreated: (id: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const store = usePairStore();
  const jurisdiction = usePair((s) => s.jurisdiction);
  const [name, setName] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;
  return (
    <Scaffold
      step="identity"
      title={t('pair.guest.identity.title')}
      error={error}
      onCancel={onCancel}
      next={() => {
        const birth = { year: Number(year), month: Number(month), day: Number(day) };
        if (name.trim().length === 0 || name.trim().length > 24 || /[@<>{}\\]/.test(name)) return setError(t('pair.guest.nameInvalid'));
        // S7 / M17 age gate first, then the jurisdiction's own ages (M20): the same rules as for the owner.
        const outcome = evaluateEligibility(birth, localToday(clock.now()), jurisdiction);
        if (outcome.status === 'invalid') return setError(t('pair.guest.birthInvalid'));
        if (outcome.status === 'blocked') return setError(t('pair.guest.notAvailable'));
        const created = store.getState().addGuest(name.trim(), birth);
        onCreated(created.id);
      }}
    >
      <Text style={text}>{t('pair.guest.handover')}</Text>
      <Input label={t('pair.guest.nameLabel')} hint={t('pair.guest.nameHint')} value={name} onChangeText={setName} testID="pair-guest-name" />
      <Text style={text}>{t('pair.guest.birthLabel')}</Text>
      <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Input label={t('ageGate.day')} value={day} onChangeText={setDay} keyboardType="number-pad" testID="pair-guest-birth-day" />
        </View>
        <View style={{ flex: 1 }}>
          <Input label={t('ageGate.month')} value={month} onChangeText={setMonth} keyboardType="number-pad" testID="pair-guest-birth-month" />
        </View>
        <View style={{ flex: 1.4 }}>
          <Input label={t('ageGate.year')} value={year} onChangeText={setYear} keyboardType="number-pad" testID="pair-guest-birth-year" />
        </View>
      </View>
      <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('pair.guest.birthHint')}</Text>
    </Scaffold>
  );
}

function GuestSteps({ id, onDone, onCancel }: { id: string; onDone: (guestId: string) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const store = usePairStore();
  usePair((s) => s.revision);
  const jurisdiction = usePair((s) => s.jurisdiction);
  const guest = store.getState().guest(id);
  const ledgers = store.getState().ledgers(id);
  const consentRecords = useStore(ledgers.consents, (s) => s.records);
  useStore(ledgers.legal, (s) => s.acceptances);
  const [step, setStep] = useState<Step>('legal');
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Partial<Record<(typeof SCREENING_QUESTIONS)[number], ScreeningAnswer>>>(guest?.profile.screening?.answers ?? {});
  const [clearance, setClearance] = useState(guest?.profile.screening?.clearanceAttested ?? false);
  const [weight, setWeight] = useState(guest?.profile.bodyweightKg != null ? String(guest.profile.bodyweightKg) : '');
  const [scopes, setScopes] = useState<PairSharingScope[]>(guest ? (sharedScopes(consentRecords, guest.sharing) ?? []) : []);
  if (!guest) return null;
  const displayName = guest.profile.displayName;
  const text = { color: theme.colors.text, fontSize: theme.fontSize.body } as const;

  if (step === 'legal') {
    const gate = guestWorkoutGate(ledgers, clock.now(), jurisdiction);
    // ADR-023: the decision in force (the consent chain, fail closed), not the last line of the ledger.
    const sharingConsent = consentState(consentRecords, 'partner_sharing').granted;
    return (
      <Scaffold
        step="legal"
        title={t('pair.guest.legal.title', { name: displayName })}
        error={error}
        onCancel={onCancel}
        next={() => {
          // L2: nothing goes further until this person has accepted their own texts and consents.
          if (!gate.allowed || !sharingConsent) return setError(t('pair.guest.legal.required'));
          setError(null);
          setStep('screening');
        }}
      >
        <Text style={text}>{t('pair.guest.legal.intro')}</Text>
        <GuestAcceptance ledgers={ledgers} documentId="terms" />
        <GuestAcceptance ledgers={ledgers} documentId="privacy" />
        <GuestConsent ledgers={ledgers} dataType="health" />
        <GuestAcceptance ledgers={ledgers} documentId="exercise_risk" />
        <GuestConsent ledgers={ledgers} dataType="partner_sharing" />
      </Scaffold>
    );
  }

  if (step === 'screening') {
    const yesNo = [
      { value: 'yes' as const, label: t('screening.yes') },
      { value: 'no' as const, label: t('screening.no') },
    ];
    const flagged = SCREENING_QUESTIONS.some((q) => answers[q] === 'yes' && SCREENING_RULES[q].kind === 'clearance_flag');
    const complete = SCREENING_QUESTIONS.every((q) => answers[q] !== undefined);
    return (
      <Scaffold
        step="screening"
        title={t('pair.guest.screening.title', { name: displayName })}
        error={error}
        onCancel={onCancel}
        next={() => {
          if (!complete) return setError(t('screening.incomplete'));
          const kg = weight.trim() === '' ? null : Number(weight.replace(',', '.'));
          if (kg !== null && !(kg >= 25 && kg <= 350)) return setError(t('pair.guest.weightInvalid'));
          store.getState().saveGuestScreening(id, { answers, clearanceAttested: clearance, birthDate: guest.profile.birthDate, answeredOn: localToday(clock.now()), limitations: [], excludedExerciseIds: [] });
          store.getState().setGuestBodyweight(id, kg);
          setError(null);
          setStep('sharing');
        }}
      >
        <Text style={text}>{t('screening.intro')}</Text>
        <Text style={{ color: theme.colors.textMuted, fontSize: theme.fontSize.label }}>{t('screening.contentStatus')}</Text>
        {SCREENING_QUESTIONS.map((q) => (
          <ChoiceGroup<ScreeningAnswer>
            key={q}
            label={t(`screening.question.${q}`, { months: MONTHS_PARAM[q] ?? 0 })}
            options={yesNo}
            value={answers[q] ?? null}
            onChange={(v) => setAnswers({ ...answers, [q]: v })}
            hint={t('screening.answerHint')}
            horizontal
            testID={`pair-guest-screening-${q}`}
          />
        ))}
        {flagged ? <Toggle label={t('screening.clearance.label')} description={t('screening.clearance.description')} value={clearance} onValueChange={setClearance} testID="pair-guest-screening-clearance" /> : null}
        <Input label={t('pair.guest.weightLabel')} hint={t('pair.guest.weightHint')} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" testID="pair-guest-weight" />
      </Scaffold>
    );
  }

  return (
    <Scaffold
      step="sharing"
      title={t('pair.guest.sharing.title', { name: displayName })}
      error={error}
      onCancel={onCancel}
      nextLabel={t('pair.guest.done')}
      next={() => {
        store.getState().recordSharing(id, scopes);
        onDone(id);
      }}
    >
      <SharingChoices name={displayName} value={scopes} onChange={setScopes} testPrefix="pair-guest" />
      <Text style={text}>{t('pair.guest.handBack')}</Text>
    </Scaffold>
  );
}
