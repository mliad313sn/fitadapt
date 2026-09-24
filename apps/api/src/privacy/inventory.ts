/**
 * Data inventory of primary storage (PostgreSQL). Every table must be listed
 * here: an integration test compares this list with the live schema, so a new
 * table cannot ship without a decision on export and erasure (ADR-005).
 *
 * - export: where the table appears in the in-app export (or why it does not);
 * - erase: how the table's rows for a user leave primary storage on deletion.
 */
export interface InventoryEntry {
  readonly table: string;
  readonly export: { readonly section: string } | { readonly excluded: string };
  readonly erase: 'cascade_from_users' | 'deleted_explicitly' | 'retained_pseudonymous';
  readonly personalData: string;
}

export const DATA_INVENTORY: readonly InventoryEntry[] = Object.freeze([
  { table: 'users', export: { section: 'user' }, erase: 'deleted_explicitly', personalData: 'email, locale, unit system' },
  { table: 'devices', export: { section: 'devices' }, erase: 'cascade_from_users', personalData: 'device id, platform, last seen' },
  { table: 'auth_sessions', export: { section: 'sessions' }, erase: 'cascade_from_users', personalData: 'sign-in sessions per device' },
  {
    table: 'refresh_tokens',
    export: { excluded: 'keyed hashes of credentials; the session each belongs to is exported under sessions' },
    erase: 'cascade_from_users',
    personalData: 'credential hashes',
  },
  {
    table: 'otp_codes',
    export: { excluded: 'short-lived keyed hashes of sign-in codes, purged after the retention period' },
    erase: 'deleted_explicitly',
    personalData: 'keyed hash of the email',
  },
  { table: 'sync_heads', export: { section: 'sync.revision' }, erase: 'cascade_from_users', personalData: 'none beyond the user id' },
  { table: 'sync_changes', export: { section: 'sync.changes' }, erase: 'cascade_from_users', personalData: 'all synced records (training logs, preferences)' },
  { table: 'sync_mutations', export: { section: 'sync.mutations' }, erase: 'cascade_from_users', personalData: 'idempotency ledger' },
  { table: 'consent_records', export: { section: 'consents' }, erase: 'cascade_from_users', personalData: 'consent decisions per data type' },
  {
    table: 'data_requests',
    export: { section: 'dataRequests' },
    erase: 'retained_pseudonymous',
    personalData: 'none: keyed subject reference only, kept as proof of the request',
  },
  {
    table: 'audit_entries',
    export: { section: 'auditTrail' },
    erase: 'retained_pseudonymous',
    personalData: 'none: keyed subject reference, action, data type, version, time (L11)',
  },
  { table: 'legal_acceptances', export: { section: 'legal.acceptances' }, erase: 'cascade_from_users', personalData: 'which legal texts were accepted, when, in which locale and jurisdiction (M20)' },
  { table: 'notice_impressions', export: { section: 'legal.notices' }, erase: 'cascade_from_users', personalData: 'which point-of-risk notices were shown or acknowledged (M20)' },
  {
    table: 'defensibility_events',
    export: { excluded: 'pseudonymous defensibility file (L11); its entries mirror legal.acceptances, legal.notices and consents; provided through the legal-hold export on request' },
    erase: 'retained_pseudonymous',
    personalData: 'none directly: keyed subject reference, document/notice ids, versions, hashes, safety reason codes, engine versions (pseudonymous, ADR-009)',
  },
  {
    table: 'defensibility_heads',
    export: { excluded: 'integrity anchor of the pseudonymous defensibility file (PKG-01, ADR-024): chain reference, length and last hash only' },
    erase: 'retained_pseudonymous',
    personalData: 'none directly: keyed subject reference, event count, hash, open-hold count, purge time',
  },
  {
    table: 'photo_backup_keys',
    export: { excluded: 'end-to-end-encrypted: the photo key wrapped by a key derived from the recovery code, which only the user holds; the service cannot read it (ADR-020). The user exports photos from the device' },
    erase: 'cascade_from_users',
    personalData: 'ciphertext only (wrapped key, KDF parameters, salt)',
  },
  {
    table: 'photo_backups',
    export: { excluded: 'end-to-end-encrypted progress photos the service cannot open (ADR-020); the in-app M04 export on the device includes them on request' },
    erase: 'cascade_from_users',
    personalData: 'ciphertext only (photo id, size, time stored); also erased when the photos consent is withdrawn or the backup is turned off',
  },
  {
    table: 'pair_sessions',
    export: { section: 'pair.participations' },
    erase: 'cascade_from_users',
    personalData: 'who started a multi-device pair session and when; keyed hash of the join code (M09); also erased when the host withdraws partner_sharing',
  },
  {
    table: 'pair_participants',
    export: { section: 'pair.participations' },
    erase: 'cascade_from_users',
    personalData: 'display name chosen for the session, sharing scopes and consent version (M09); also erased on a partner_sharing withdrawal',
  },
  {
    table: 'pair_events',
    export: { section: 'pair.events' },
    erase: 'cascade_from_users',
    personalData: 'events a participant sent to the partner (turns; reps and loads, body weight or score only with that scope) (M09); also erased on a partner_sharing withdrawal',
  },
  {
    table: 'safety_locks',
    export: { section: 'safetyLocks' },
    erase: 'cascade_from_users',
    personalData: 'while an S3 intensity lock is on: whether each fact is a red flag or a medical-review attestation, its time and causal ids (no symptom, no other health value); kept after a health-consent withdrawal, deleted when the lock is lifted (MOB-08, ADR-024; retention basis validated:false, B1/counsel)',
  },
]);
