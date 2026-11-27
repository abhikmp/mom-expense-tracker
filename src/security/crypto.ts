import type { SaltedHash } from '../domain/types';

const PBKDF2_ALGORITHM = 'PBKDF2-SHA256' as const;
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BITS = 256;
const PIN_REGEX = /^\d{4,6}$/;
const MIN_MASTER_PASSWORD_LENGTH = 8;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKeyBytes(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const encoder = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

/**
 * Strips non-digit characters and limits PIN input to at most 6 digits.
 */
export function sanitizePinInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/**
 * Validates that a PIN is 4 to 6 numeric digits.
 */
export function validatePin(pin: string): { valid: true } | { valid: false; error: string } {
  if (!PIN_REGEX.test(pin)) {
    return { valid: false, error: 'PIN must be 4 to 6 digits.' };
  }
  return { valid: true };
}

/**
 * Validates that a Master Password has at least 8 characters.
 */
export function validateMasterPassword(
  password: string
): { valid: true } | { valid: false; error: string } {
  if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
    return { valid: false, error: 'Master Password must be at least 8 characters.' };
  }
  return { valid: true };
}

/**
 * Hashes a PIN or Master Password with PBKDF2-SHA256 and a random 16-byte salt.
 */
export async function hashSecret(secret: string): Promise<SaltedHash> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await deriveKeyBytes(secret, salt, PBKDF2_ITERATIONS);

  return {
    algorithm: PBKDF2_ALGORITHM,
    iterations: PBKDF2_ITERATIONS,
    saltB64: toBase64(salt),
    hashB64: toBase64(derived),
  };
}

/**
 * Verifies a secret against a stored PBKDF2-SHA256 salted hash using constant-length XOR comparison.
 */
export async function verifySecret(secret: string, stored: SaltedHash): Promise<boolean> {
  if (
    !stored ||
    stored.algorithm !== PBKDF2_ALGORITHM ||
    !Number.isSafeInteger(stored.iterations) ||
    stored.iterations <= 0 ||
    typeof stored.saltB64 !== 'string' ||
    typeof stored.hashB64 !== 'string'
  ) {
    return false;
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(stored.saltB64);
    expected = fromBase64(stored.hashB64);
  } catch {
    return false;
  }

  if (salt.length === 0 || expected.length === 0) {
    return false;
  }

  const actual = await deriveKeyBytes(secret, salt, stored.iterations);

  if (actual.length !== expected.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual[i] ^ expected[i];
  }
  return diff === 0;
}
