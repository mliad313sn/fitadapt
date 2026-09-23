import * as SecureStore from 'expo-secure-store';

/**
 * Where the refresh token lives. On the device: the OS keystore through
 * expo-secure-store (Keychain / Android Keystore), never SQLite or logs
 * (ADR-003, ADR-006, MASVS-STORAGE-1). The access token stays in memory.
 */
export interface TokenVault {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  remove(): Promise<void>;
}

const KEY = 'refresh_token';

export const secureStoreVault: TokenVault = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token) => SecureStore.setItemAsync(KEY, token, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
  remove: () => SecureStore.deleteItemAsync(KEY),
};

export class MemoryVault implements TokenVault {
  token: string | null = null;
  async get() {
    return this.token;
  }
  async set(token: string) {
    this.token = token;
  }
  async remove() {
    this.token = null;
  }
}
