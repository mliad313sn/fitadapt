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
} as const;

export type MessageKey = keyof typeof en;
