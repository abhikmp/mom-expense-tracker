import { describe, expect, it } from 'vitest';
import {
  hashSecret,
  sanitizePinInput,
  validateMasterPassword,
  validatePin,
  verifySecret,
} from '../../src/security/crypto';

describe('PIN and Master Password validation helpers', () => {
  it('sanitizePinInput strips non-digits and truncates to 6 digits', () => {
    expect(sanitizePinInput('12a34b567')).toBe('123456');
    expect(sanitizePinInput('  9-8 7! ')).toBe('987');
    expect(sanitizePinInput('abcdef')).toBe('');
  });

  it('validatePin accepts 4 to 6 digits and rejects shorter, longer, or non-digit values', () => {
    expect(validatePin('123')).toEqual({
      valid: false,
      error: 'PIN must be 4 to 6 digits.',
    });
    expect(validatePin('1234567')).toEqual({
      valid: false,
      error: 'PIN must be 4 to 6 digits.',
    });
    expect(validatePin('12ab')).toEqual({
      valid: false,
      error: 'PIN must be 4 to 6 digits.',
    });
    expect(validatePin('1234')).toEqual({ valid: true });
    expect(validatePin('123456')).toEqual({ valid: true });
  });

  it('validateMasterPassword requires at least 8 characters of any kind', () => {
    expect(validateMasterPassword('1234567')).toEqual({
      valid: false,
      error: 'Master Password must be at least 8 characters.',
    });
    expect(validateMasterPassword('abcd1234')).toEqual({ valid: true });
    expect(validateMasterPassword('        ')).toEqual({ valid: true });
  });
});

describe('hashSecret and verifySecret', () => {
  it('verifies matching secrets, rejects wrong secrets, and uses distinct random salts', async () => {
    const first = await hashSecret('2580');
    const second = await hashSecret('2580');

    expect(first.algorithm).toBe('PBKDF2-SHA256');
    expect(first.iterations).toBe(100_000);
    expect(first.saltB64).not.toBe('');
    expect(first.hashB64).not.toBe('');
    expect(first.saltB64).not.toBe(second.saltB64);
    expect(first.hashB64).not.toBe(second.hashB64);

    await expect(verifySecret('2580', first)).resolves.toBe(true);
    await expect(verifySecret('2580', second)).resolves.toBe(true);
    await expect(verifySecret('0852', first)).resolves.toBe(false);

    const passwordHash = await hashSecret('My Mom Pass! 2026');
    await expect(verifySecret('My Mom Pass! 2026', passwordHash)).resolves.toBe(true);
    await expect(verifySecret('wrong-password', passwordHash)).resolves.toBe(false);
  });

  it('returns false cleanly on malformed SaltedHash records instead of throwing', async () => {
    const valid = await hashSecret('1234');

    await expect(verifySecret('1234', { ...valid, algorithm: 'SHA-1' as 'PBKDF2-SHA256' })).resolves.toBe(
      false
    );
    await expect(verifySecret('1234', { ...valid, iterations: 0 })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, iterations: -10 })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, iterations: Number.NaN })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, iterations: 1.5 })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, iterations: Number.POSITIVE_INFINITY })).resolves.toBe(
      false
    );
    await expect(verifySecret('1234', { ...valid, saltB64: '!!!not-base64!!!' })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, hashB64: '!!!not-base64!!!' })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, saltB64: '' })).resolves.toBe(false);
    await expect(verifySecret('1234', { ...valid, hashB64: '' })).resolves.toBe(false);
  });
});
