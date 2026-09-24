import * as SecureStore from 'expo-secure-store';

/**
 * Keys that protect health data at rest on the device (ADR-006, ADR-020):
 * random 256-bit keys created on first use and kept only in the OS keystore
 * (iOS Keychain, Android Keystore) through expo-secure-store, readable after
 * the first unlock and never migrated to another device or into a backup
 * (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`). Never written to SQLite, files,
 * logs or analytics.
 */
export interface DeviceKeyStore {
  get(name: string): string | null;
  set(name: string, value: string): void;
  /**
   * Deletes the key and resolves once the keystore confirms it (MOB-14):
   * crypto-erasure is only reported done after this resolves; a rejection is
   * the caller's to report.
   */
  remove(name: string): Promise<void>;
}

export const DEVICE_KEY_NAMES = { database: 'local_database_key_v1', photos: 'progress_photo_key_v1' } as const;

const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY } as const;

/** The OS keystore (synchronous API: the database is opened synchronously at start-up). */
export const secureDeviceKeyStore: DeviceKeyStore = {
  get: (name) => SecureStore.getItem(name, OPTIONS),
  set: (name, value) => SecureStore.setItem(name, value, OPTIONS),
  remove: (name) => SecureStore.deleteItemAsync(name, OPTIONS),
};

/**
 * Deletes a key and checks it is gone (MOB-14). Resolves true when the
 * keystore no longer holds it; false (never throws) when the delete failed or
 * the key is still readable, so the caller can report that crypto-erasure was
 * not confirmed. Nothing about the key itself is reported.
 */
export async function eraseKey(store: DeviceKeyStore, name: string): Promise<boolean> {
  try {
    await store.remove(name);
    return store.get(name) === null;
  } catch {
    return false;
  }
}

const HEX_KEY = /^[0-9a-f]{64}$/;

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): Uint8Array {
  if (!HEX_KEY.test(hex)) throw new Error('not a 256-bit hex key');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * The key stored under `name`, created from 32 random bytes the first time.
 * A stored value that is not a 256-bit hex key is replaced (fail closed: the
 * data it protected cannot be read with a damaged key anyway).
 */
export function getOrCreateKey(store: DeviceKeyStore, name: string, randomBytes: (n: number) => Uint8Array): { hex: string; created: boolean } {
  const existing = store.get(name);
  if (existing !== null && HEX_KEY.test(existing)) return { hex: existing, created: false };
  const bytes = randomBytes(32);
  if (bytes.length !== 32) throw new Error('the random source returned the wrong length');
  const hex = toHex(bytes);
  store.set(name, hex);
  return { hex, created: true };
}

export class MemoryDeviceKeyStore implements DeviceKeyStore {
  readonly items = new Map<string, string>();
  get(name: string) {
    return this.items.get(name) ?? null;
  }
  set(name: string, value: string) {
    this.items.set(name, value);
  }
  /** Test hook: the next removals reject with this error (null: they work again). */
  failRemovals: Error | null = null;
  async remove(name: string) {
    if (this.failRemovals) throw this.failRemovals;
    this.items.delete(name);
  }
}
