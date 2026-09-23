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
]);
