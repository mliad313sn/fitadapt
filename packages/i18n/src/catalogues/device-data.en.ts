/**
 * Local data lifecycle wording (EN), from the mobile code-review fix wave
 * (MOB-01…MOB-14): the photo backup on a second phone, restores that skip
 * unreadable photos, the account a phone's data belongs to, a partner's
 * export, consent withdrawal and hand-over, and the device evidence log.
 * No guilt, no pressure, no medical claims.
 */
export const deviceDataEn = {
  // ---- MOB-02: a backup already exists on the account
  'photos.backup.checking': 'Checking your account for an existing backup…',
  'photos.backup.existing.title': 'You already have a backup',
  'photos.backup.existing.body':
    'Your account already holds an encrypted photo backup, made on another phone. Enter its recovery code: this phone then uses the same backup, and your photos here are added to it. A new code is not offered, because it would make the existing backup impossible to open.',
  'photos.backup.existing.code': 'Recovery code of your existing backup',
  'photos.backup.existing.codeHint': 'The code you wrote down when you first turned on the backup',
  'photos.backup.existing.join': 'Use my existing backup',
  'photos.backup.existing.cancel': 'Not now',
  'photos.backup.joined': '{count, plural, =0 {This phone now uses your existing backup.} one {This phone now uses your existing backup. # photo restored.} other {This phone now uses your existing backup. # photos restored.}}',
  'photos.restore.skipped': '{count, plural, one {# photo could not be opened with this backup’s key and was skipped.} other {# photos could not be opened with this backup’s key and were skipped.}}',

  // ---- MOB-07: this phone holds another account's data
  'signIn.otherAccount':
    'This phone holds data from another account. To keep the two apart, sign in with that account, or first delete this phone’s data.',
  'signIn.otherAccount.erase': 'Delete this phone’s data',
  'signIn.otherAccount.eraseHint': 'Removes the other account’s data from this phone only. Data already synced stays in that account.',
  'signIn.otherAccount.confirm': 'Yes, delete this phone’s data',
  'signIn.otherAccount.erased': 'This phone’s data was deleted. You can now sign in.',

  // ---- MOB-06: a partner's export
  'pair.partner.exportFailed': 'The export for {name} could not be shared. Nothing was sent. Try again.',

  // ---- MOB-09: a partner withdraws a consent
  'pair.consent.withdraw': 'Withdraw my consent',
  'pair.consent.withdrawHint': 'Stops this from now on. Your data on this phone stays until you delete it.',
  'pair.consent.withdrawn': 'Consent withdrawn.',

  // ---- MOB-10: the partner confirms it is them
  'pair.guest.confirm.title': 'Hand the phone to {name}',
  'pair.guest.confirm.body':
    '{name}, the next steps are yours: your own texts, consents and health questions. Only continue if you are {name} and are holding the phone yourself.',
  'pair.guest.confirm.toggle': 'I am {name} and I am answering for myself',
  'pair.guest.confirm.required': 'Only {name} can confirm this step.',
  'pair.guest.screening.again': 'For your privacy, earlier answers are not shown again. Please answer each question afresh.',

  // ---- A6: Fair Pair summary (cooperative by default)
  'pair.done.together': '{count, plural, =0 {You trained together today.} one {Together you completed # set.} other {Together you completed # sets.}}',
  'pair.done.showEach': 'Show each person’s sets',
  'pair.done.showEachHint': 'Only if you both want to see them side by side',

  // ---- MOB-11: the device evidence log
  'legal.log.chainReset': 'Part of this phone’s record of acceptances and notices could not be checked. It was kept aside unchanged and a new record was started.',
} as const;
