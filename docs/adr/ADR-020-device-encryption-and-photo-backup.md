# ADR-020: Health data encrypted at rest on the device (SQLCipher, fail closed) and progress photos with an end-to-end-encrypted backup

- Status: Accepted (M04). Implements the "device database", "progress photos" and "photo backup (E2E)" rows of [ADR-006](ADR-006-encryption-and-key-management.md), planned there for M01/M04.
- Date: 2026-09-24
- Deciders: M04 engineer, on the PO's mandatory requirement for M04: health data at rest on the device must be encrypted; tests must prove the stored bytes are not plaintext (database and photos), that the app still works offline, and that it fails closed.
- Review needed: PE-11 (security) with the pen-tester and seat B1 (privacy/DPO) for the key handling, the KDF parameters and the backup design; counsel for the third-party notices (SQLCipher BSD-style licence, OpenSSL Apache-2.0 on Android). Nothing here is validated.

## Context

Since M01 the device database (`local.db`, expo-sqlite) held health data — screenings, pain reports, readiness checks, sessions — in plaintext (docs/status/M01.md: "device database encryption (SQLCipher) is still not built"). M04 adds body weight, circumferences and progress photos, "among the most sensitive data the app holds" (spec). CLAUDE.md rule 7: photos stay encrypted on the device unless backup is enabled. ADR-006 fixed the target design; there is no device or emulator in this environment.

## Decision

### Device database: SQLCipher, key in the OS keystore, fail closed (`apps/mobile/src/storage`)

- expo-sqlite is built with **SQLCipher** (`["expo-sqlite", { "useSQLCipher": true }]` in app.json → build properties `expo.sqlite.useSQLCipher=true` for Android and iOS, checked with `npx expo config --type introspect`). expo-sqlite 57 vendors **SQLCipher 4.7.0 community** (SQLite 3.49.1): AES-256 per page with a per-page HMAC-SHA512 (SQLCipher 4 defaults); CommonCrypto on iOS, OpenSSL on Android.
- The key is **32 random bytes** (`expo-crypto` `getRandomBytes`) created on first use and kept only in **expo-secure-store** (iOS Keychain, Android Keystore) with `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`: readable after the first unlock (a workout reminder or a background sync can open the database), never migrated to another device or into a backup. It is given to SQLCipher as a raw key (`PRAGMA key = "x'…'"`, validated hex, no KDF needed) before any other statement. Never written to SQLite, files, logs or analytics.
- `openEncryptedDatabase` then checks `PRAGMA cipher_version` (empty → the library has no cipher) and reads `sqlite_master` (fails when the key does not open the file); `PRAGMA secure_delete = ON` overwrites deleted rows.
- **Fail closed.** No cipher in the build, or a keystore failure: the database is **not opened**, and the app shows `StorageUnavailableScreen` (FR/EN) instead of itself — nothing opened, read, written or sent, no unencrypted fallback; only the error type is reported. A file the key no longer opens (keystore reset, restored copy) cannot be read by anyone: it is deleted and a new encrypted database created (synced records come back from the account; only the reason `key_mismatch` is reported).
- **Migration.** On the first start of M04 the pre-M04 plaintext `local.db` is attached (`KEY ''`), every table copied into the encrypted database in one transaction, then the plaintext file deleted; a failed copy rolls back and keeps the plaintext file for the next start. The legacy file is not touched when the encrypted database cannot be opened.
- Everything else (Drizzle, the sync store, the key-value store, the exercise library, photo metadata, the M10 inbox) is unchanged on top of the encrypted connection.

### Progress photos (`apps/mobile/src/progress/photo-vault.ts`, `photo-crypto.ts`)

- Each photo is sealed before it touches storage: **AES-256-GCM** (@noble/ciphers, MIT, audited, pure TypeScript — the same code on both platforms and in tests), a fresh 96-bit nonce per file, the photo id as associated data (an envelope cannot be swapped for another photo's). Envelope: `version (1) ‖ nonce (12) ‖ ciphertext ‖ tag (16)`; it holds the image and its metadata, so a backup restores both.
- A separate random 256-bit **photo key** in the keystore (same accessibility). Files in the app-private documents directory (`progress-photos/<id>.bin`), never the shared photo library; the picker's cache copy is read and deleted at once; the image is decrypted in memory only for display and not drawn while the app is in the app switcher or the background. Metadata in the encrypted database (table `progress_photo`, never synced).
- Withdrawing the `photos` consent, or wiping local data, deletes every photo file, the metadata and the photo key.

### End-to-end-encrypted backup (`photo-backup.ts`; `apps/api/src/photos`, `routes/photos.ts`)

- Off by default; only with the `photos` consent (feature `photos.backup`), a signed-in account and the user's explicit choice after a **recovery code** is shown once (20 Crockford base32 characters, 100 bits; never stored or sent) and the user confirms they wrote it down; the screen says that losing it means the backup cannot be opened.
- What leaves the device: the photo key wrapped (AES-256-GCM) by a key derived from the recovery code with **scrypt** (N = 2^15, r = 8, p = 1, random 16-byte salt; `photos.config.ts`, `validated: false`), and each photo's encrypted file **exactly as stored**. The service can open neither. Restore on a new phone: the code unwraps the key; photos already on that phone are re-encrypted under it.
- Server: `PUT/GET /v1/photos/backup/key`, `PUT/GET /v1/photos/backup/photos/:photoId`, `GET /v1/photos/backup/photos`, `DELETE /v1/photos/backup`; bearer auth, `photos` consent; opaque `application/octet-stream` bodies up to `maxEnvelopeBytes`; anything not framed as an envelope (a plain JPEG or PNG, truncated, unknown version) refused; no photo without a stored key; tables `photo_backup_keys`, `photo_backups` (migration 0006), erased when the backup is turned off, when the consent is withdrawn (in the withdrawal transaction) and with the account (cascade). The M17 server export excludes them (ciphertext the service cannot read); the device export includes photos on request.

## Evidence (what the tests prove, and what they cannot)

There is no device here. The jest tests replace expo-sqlite with **better-sqlite3-multiple-ciphers** (SQLite3 Multiple Ciphers, MIT, dev dependency) in its SQLCipher 4 mode, writing **real files**, and run the app's real `openExpoDatabase` → `openEncryptedDatabase` → Drizzle path, then read the bytes on disk (`__tests__/encrypted-db.test.ts`, `__tests__/device-storage.e2e.test.tsx`; the dashboard, photos and export tests also run on it). The stand-in is **byte-compatible** with the SQLCipher expo-sqlite ships: `apps/mobile/scripts/sqlcipher-crosscheck.sh` compiles expo-sqlite's vendored SQLCipher 4.7.0 (OpenSSL crypto, as Android) and shows that a file written by the stand-in opens with it under the same raw key and the reverse, and that a wrong or missing key opens neither (output in docs/status/M04.md). The keystore is the expo-secure-store stand-in (jest.setup.js), which records the accessibility option.

Not provable without a phone: that the native build really links SQLCipher (`PRAGMA cipher_version` on the device), the Keychain/Keystore behaviour (after-first-unlock, this-device-only, loss on reinstall), the migration of a real pre-M04 install, and that no plaintext copy appears elsewhere (WAL, OS caches, the picker's temporary file). The manual device test is in docs/status/M04.md.

## Alternatives rejected

- **Full-disk encryption only** (ADR-006): does not protect against backups of other apps, a shared unlocked phone or a rooted device.
- **Encrypting fields in JSON** above plain SQLite: leaves indexes, table names, timestamps and free pages in clear; every query path would need it.
- **A passphrase-derived database key**: the app must open offline without asking for a secret at every start; the keystore is the secret store.
- **op-sqlite / react-native-quick-sqlite with SQLCipher**: a second SQLite binding next to expo-sqlite; expo-sqlite's own `useSQLCipher` keeps one driver and Drizzle's existing adapter.
- **Falling back to plaintext** when the cipher is missing: exactly what the PO's requirement forbids.
- **Server-side encryption of photos**: the service would hold the key; the spec asks for end-to-end encryption.
- **A home-made cipher or KDF**: never; AES-GCM and scrypt from audited libraries.

## Consequences

- Before release: run the manual device test (docs/status/M04.md) on an iPhone and an Android phone; add SQLCipher (BSD-style) and OpenSSL (Apache-2.0) to the app's third-party notices (counsel).
- iOS backups: the database and photo files are not yet excluded from iCloud/iTunes backups (ADR-006 row "Device backups", iOS). A backup holds only ciphertext and the keys are this-device-only, so a backup restored to another phone cannot be opened; excluding the files is still to do (M19).
- The photo backup stores envelopes in PostgreSQL (`bytea`); M19 may move them to object storage behind the same API.
- Losing the recovery code loses the backup by design; a key-mismatch reset loses unsynced local records by design (they cannot be read).
