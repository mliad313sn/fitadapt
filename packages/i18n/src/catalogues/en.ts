import { assessmentEn } from './assessment.en.js';
import { programEn } from './program.en.js';
import { sessionEn } from './session.en.js';
import { recoveryEn } from './recovery.en.js';
import { recoveryMedicalEn } from './recovery-medical.en.js';
import { cardioEn } from './cardio.en.js';
import { progressEn } from './progress.en.js';
import { legalEn } from './legal.en.js';
import { libraryEn } from './library.en.js';
import { onboardingEn } from './onboarding.en.js';
import { screeningEn } from './screening.en.js';

/**
 * English catalogue (ICU MessageFormat). Every key must also exist in fr.ts;
 * the parity test enforces identical keys and placeholders.
 */
export const en = {
  'home.title': 'Welcome',
  'home.subtitle': 'Your sessions work offline, in English or French.',
  'home.syncStatus':
    '{count, plural, =0 {Everything is synced} one {# change waiting to sync} other {# changes waiting to sync}}',
  'home.language.switch': 'Switch to French',
  'home.language.switchHint': 'Changes the language of the whole app',
  'home.gymMode.enable': 'Turn on gym mode',
  'home.gymMode.disable': 'Turn off gym mode',
  'home.gymMode.hint': 'Larger buttons and numbers, easier to use at arm’s length',
  'home.units.metric': 'Units: metric (kg, cm)',
  'home.units.imperial': 'Units: imperial (lb, in)',
  'home.units.switchHint': 'Switches between metric and imperial units',
  'home.offlineCard.title': 'Works offline',
  'home.offlineCard.body': 'Changes are saved on this device and sent when you are back online.',

  'home.privacy.open': 'Privacy settings',
  'home.privacy.openHint': 'Choose what data you share, download it or delete your account',

  'ui.toggle.on': 'On',
  'ui.toggle.off': 'Off',

  // M17 age gate (S7). Plain UI copy; no legal wording.
  'ageGate.title': 'Before you start',
  'ageGate.body': 'Enter your date of birth. It is only used to check that this app is suitable for you and is not kept.',
  'ageGate.day': 'Day',
  'ageGate.month': 'Month',
  'ageGate.year': 'Year',
  'ageGate.dayHint': 'Day of birth, for example 7',
  'ageGate.monthHint': 'Month of birth, from 1 to 12',
  'ageGate.yearHint': 'Year of birth, four digits',
  'ageGate.continue': 'Continue',
  'ageGate.error.not_a_date': 'Please enter a real date.',
  'ageGate.error.in_future': 'This date is in the future.',
  'ageGate.blocked.title': 'This app is not available to you yet',
  'ageGate.blocked.body': 'You need to be 16 or older to use this app. Thank you for your interest.',

  // M17 privacy settings. Labels only: consent texts themselves are DRAFTS owned by
  // M20 (packages/legal) and require counsel review; `version` refers to them.
  'privacy.title': 'Privacy',
  'privacy.intro': 'Choose what you share. Nothing is on until you turn it on, and you can change each setting at any time.',
  'privacy.consentHint': 'Turns the use of this data on or off',
  'privacy.consent.health.label': 'Health data',
  'privacy.consent.health.description': 'Health screening answers and pain check-ins',
  'privacy.consent.photos.label': 'Progress photos',
  'privacy.consent.photos.description': 'Progress photos and their optional backup',
  'privacy.consent.wearables.label': 'Wearables and health apps',
  'privacy.consent.wearables.description': 'Data imported from connected devices and health apps',
  'privacy.consent.ai_coach.label': 'AI coach',
  'privacy.consent.ai_coach.description': 'Conversations with the AI coach, an automated assistant',
  'privacy.consent.analytics.label': 'Usage statistics',
  'privacy.consent.analytics.description': 'Statistics about how the app is used, without your name or email',
  'privacy.consent.partner_sharing.label': 'Training partner sharing',
  'privacy.consent.partner_sharing.description': 'What your training partner sees during a pair session; you choose the details each time',
  'privacy.consent.renewal': 'The terms for this setting have changed. Turn it on again to keep using it.',
  'privacy.export.button': 'Download my data',
  'privacy.export.hint': 'Prepares a copy of all your data to save or share',
  'privacy.export.done': 'Your data is ready.',
  'privacy.delete.button': 'Delete my account',
  'privacy.delete.hint': 'Opens a confirmation before anything is deleted',
  'privacy.delete.confirmTitle': 'Delete your account?',
  'privacy.delete.confirmBody': 'Your account and its data are deleted now, on this device and on our servers. Copies in our backups are erased within {days, plural, one {# day} other {# days}}.',
  'privacy.delete.confirm': 'Delete permanently',
  'privacy.delete.cancel': 'Keep my account',
  'privacy.delete.done': 'Your account has been deleted.',
  'privacy.signedOut': 'Sign in to download your data or delete your account.',

  'ui.stepper.increase': 'Increase {label}',
  'ui.stepper.decrease': 'Decrease {label}',
  'ui.stepper.value': '{label}: {value}',
  'ui.timer.start': 'Start timer',
  'ui.timer.pause': 'Pause timer',
  'ui.timer.reset': 'Reset timer',
  'ui.timer.remaining': '{minutes, plural, one {# minute} other {# minutes}} {seconds, plural, one {# second} other {# seconds}} remaining',
  'ui.numberDisplay.value': '{label}: {value}',
  'ui.sheet.close': 'Close',
  'ui.toast.dismiss': 'Dismiss notification',

  'units.kg': '{value} kg',
  'units.lb': '{value} lb',
  'units.cm': '{value} cm',
  'units.in': '{value} in',
  'units.km': '{value} km',
  'units.mi': '{value} mi',

  'errors.auth.invalid_code': 'This code is incorrect or has expired. Request a new one.',
  'errors.auth.rate_limited': 'Too many attempts. Please wait a few minutes and try again.',
  'errors.auth.invalid_refresh_token': 'Your session has ended. Please sign in again.',
  'errors.auth.refresh_token_reused': 'For your security, you have been signed out. Please sign in again.',
  'errors.auth.unauthorized': 'Please sign in to continue.',
  'errors.auth.provider_not_configured': 'This sign-in method is not available yet.',
  'errors.generic': 'Something went wrong. Please try again.',

  'coachWeb.title': 'Coach portal',
  'coachWeb.placeholder': 'The coach portal is being built. Nothing to do here yet.',

  // Store listing copy (M20: linted by `pnpm legal:claims`; store/metadata is generated from these keys).
  // The public name is a placeholder until trademark clearance (L7); the codename never appears here.
  'store.listing.name': 'Companion (working title)',
  'store.listing.subtitle': 'Strength training that adapts to you',
  'store.listing.description': 'A bilingual training companion that builds each session from your goals, your equipment and how you feel today. Every recommendation explains itself. Sessions work offline. Train alone or with a partner of a different level on the same phone. General fitness guidance only, not medical advice.',
  'store.listing.keywords': 'workout,training,strength,fitness,offline,partner,bodyweight',
  'store.listing.promotionalText': 'Explainable training plans that work offline, in English and French.',

  // M20 legal texts: DRAFTS that require counsel review (see legal.en.ts).
  ...legalEn,

  // M06 exercise library: labels, engine substitution reasons and exercise wording (seed content, not expert-validated).
  ...libraryEn,

  // M01 onboarding, profile, sign-in and first session.
  ...onboardingEn,

  // M01 health screening: original wording, licence check pending, awaiting seat A1 review (screening.en.ts).
  ...screeningEn,

  // M07 assessment, capacity model and first session (engine reason codes included).
  ...assessmentEn,

  // M08 program, calendar and reflow (engine reason codes included; no-guilt copy after a missed session).
  ...programEn,

  // M02 session engine reason codes and the workout screens (no pressure, no guilt).
  ...sessionEn,

  // M05 recovery: warm-up, cool-down, readiness, deloads, mobility sessions (no pressure, no guilt).
  ...recoveryEn,

  // M05 health-related wording: REQUIRES PHYSICIAN REVIEW (seats A1, A2; counsel for the review statement).
  ...recoveryMedicalEn,

  // M03 cardio and conditioning: reason codes, spoken interval cues and screens (effort-named zones only, C9).
  ...cardioEn,

  // M04 progress dashboard, body data, encrypted progress photos, export (no body-shaming; forecasts are estimates).
  ...progressEn,
} as const;

export type MessageKey = keyof typeof en;
