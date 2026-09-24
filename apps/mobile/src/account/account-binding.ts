import type { KeyValueStore } from '../storage/app-state';

/**
 * Which account this phone's data belongs to (MOB-07). Everything the phone
 * records before the first sign-in (profile, logs, ledgers, the sync outbox)
 * belongs to whoever signs in first; from then on only that account may
 * sign in on this phone until its data is erased from the phone. Another
 * account signing in would otherwise receive the first person's outbox,
 * skip its own consent upload (the ledger says "uploaded") and merge both
 * people's records.
 *
 * The account id is kept in the encrypted database (`app_kv`), so an
 * account deletion or "delete this phone's data" (wipeLocalDatabase)
 * removes the binding with the data.
 */
const ACCOUNT_KEY = 'device_account_id';

/** Another account's data is on this phone: the sign-in was refused and its new session ended at once. */
export class OtherAccountDataError extends Error {
  constructor() {
    super("this phone holds another account's data");
    this.name = 'OtherAccountDataError';
  }
}

export class AccountBinding {
  constructor(private readonly kv: KeyValueStore) {}

  /** The account this phone's data belongs to (null: nobody has signed in since the data was created or erased). */
  boundTo(): string | null {
    return this.kv.get(ACCOUNT_KEY) ?? null;
  }

  /**
   * Called with the account that just proved its identity. True (and bound,
   * the first time) when this phone's data is that account's; false when it
   * belongs to another account (nothing is changed).
   */
  claim(accountId: string): boolean {
    const bound = this.boundTo();
    if (bound === null) {
      this.kv.set(ACCOUNT_KEY, accountId);
      return true;
    }
    return bound === accountId;
  }
}
