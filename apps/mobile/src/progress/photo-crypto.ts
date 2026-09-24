import { gcm } from '@noble/ciphers/aes';
import { scrypt } from '@noble/hashes/scrypt';
import { PHOTO_ENVELOPE_NONCE_BYTES, PHOTO_ENVELOPE_VERSION } from '@fitadapt/shared';

/**
 * Photo encryption (ADR-006, ADR-020): AES-256-GCM with a random 96-bit nonce
 * per file, from @noble/ciphers (MIT, audited, pure TypeScript: the same code
 * on iOS, Android and in tests). The envelope is
 * `version (1 byte) ‖ nonce (12) ‖ ciphertext ‖ tag (16)`; the associated
 * data binds it to the photo id, so an envelope cannot be swapped for
 * another photo's. No home-made algorithm.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function sealEnvelope(key: Uint8Array, plaintext: Uint8Array, nonce: Uint8Array, associatedData: string): Uint8Array {
  if (key.length !== 32) throw new Error('photo key must be 256 bits');
  if (nonce.length !== PHOTO_ENVELOPE_NONCE_BYTES) throw new Error('nonce must be 96 bits');
  const sealed = gcm(key, nonce, encoder.encode(associatedData)).encrypt(plaintext);
  const out = new Uint8Array(1 + nonce.length + sealed.length);
  out[0] = PHOTO_ENVELOPE_VERSION;
  out.set(nonce, 1);
  out.set(sealed, 1 + nonce.length);
  return out;
}

/** Throws when the envelope was not made with this key for this id (or was altered). */
export function openEnvelope(key: Uint8Array, envelope: Uint8Array, associatedData: string): Uint8Array {
  if (envelope[0] !== PHOTO_ENVELOPE_VERSION) throw new Error('unknown envelope version');
  const nonce = envelope.subarray(1, 1 + PHOTO_ENVELOPE_NONCE_BYTES);
  return gcm(key, nonce, encoder.encode(associatedData)).decrypt(envelope.subarray(1 + PHOTO_ENVELOPE_NONCE_BYTES));
}

/** What an envelope holds: the photo's metadata (JSON) and the image, so a backup restores both. */
export function packPhoto(meta: unknown, image: Uint8Array): Uint8Array {
  const json = encoder.encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length + image.length);
  new DataView(out.buffer).setUint32(0, json.length);
  out.set(json, 4);
  out.set(image, 4 + json.length);
  return out;
}

export function unpackPhoto(packed: Uint8Array): { meta: unknown; image: Uint8Array } {
  const length = new DataView(packed.buffer, packed.byteOffset, packed.byteLength).getUint32(0);
  if (4 + length > packed.length) throw new Error('damaged photo payload');
  return { meta: JSON.parse(decoder.decode(packed.subarray(4, 4 + length))), image: packed.slice(4 + length) };
}

// ---- Recovery code and key wrapping (end-to-end-encrypted backup)

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A random recovery code in Crockford base32 (no I, L, O, U), grouped by 4: e.g. `7K2M-…`. */
export function recoveryCode(randomBytes: (n: number) => Uint8Array, chars: number): string {
  const bytes = randomBytes(chars);
  let code = '';
  for (let i = 0; i < chars; i += 1) code += CROCKFORD[bytes[i]! & 31];
  return code.match(/.{1,4}/g)!.join('-');
}

/** Normalises what the user types: case, spaces and dashes do not matter; O→0, I/L→1 (Crockford). */
export function normaliseRecoveryCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export interface KdfParams {
  readonly logN: number;
  readonly r: number;
  readonly p: number;
}

/** The key-encryption key: scrypt (memory-hard) of the recovery code with a random salt. */
export function deriveWrappingKey(code: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return scrypt(encoder.encode(normaliseRecoveryCode(code)), salt, { N: 2 ** params.logN, r: params.r, p: params.p, dkLen: 32 });
}

export const WRAPPED_KEY_AAD = 'progress-photo-key-v1';

const BASE64_CODES = new TextEncoder().encode('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/');
const PAD = 61; // '='

/**
 * Base64 without string concatenation (MOB-05): the ASCII codes are written
 * into one byte array and decoded once, so a multi-megabyte photo is encoded
 * in one pass instead of millions of string appends on the JS thread.
 */
export const toBase64 = (bytes: Uint8Array): string => {
  const out = new Uint8Array(Math.ceil(bytes.length / 3) * 4);
  let j = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out[j] = BASE64_CODES[(n >> 18) & 63]!;
    out[j + 1] = BASE64_CODES[(n >> 12) & 63]!;
    out[j + 2] = i + 1 < bytes.length ? BASE64_CODES[(n >> 6) & 63]! : PAD;
    out[j + 3] = i + 2 < bytes.length ? BASE64_CODES[n & 63]! : PAD;
    j += 4;
  }
  return decoder.decode(out);
};

export const fromBase64 = (text: string): Uint8Array => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let j = 0;
  for (const ch of clean) {
    const v = alphabet.indexOf(ch);
    if (v < 0) throw new Error('not base64');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (value >> bits) & 255;
    }
  }
  return out;
};
