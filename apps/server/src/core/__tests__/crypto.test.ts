import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '../crypto.js';

// 32-byte key as 64 hex chars.
const KEY = 'a'.repeat(64);
const OTHER_KEY = 'b'.repeat(64);

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext string', () => {
    const plain = 'ya29.some-google-access-token-value';

    const encrypted = encryptSecret(plain, KEY);
    const decrypted = decryptSecret(encrypted, KEY);

    expect(decrypted).toBe(plain);
  });

  it('produces different ciphertext each call (random IV)', () => {
    const plain = 'same-token';

    const a = encryptSecret(plain, KEY);
    const b = encryptSecret(plain, KEY);

    expect(a).not.toBe(b);
    // ...but both decrypt back to the same plaintext.
    expect(decryptSecret(a, KEY)).toBe(plain);
    expect(decryptSecret(b, KEY)).toBe(plain);
  });

  it('stores as iv:tag:ciphertext (three hex segments)', () => {
    const encrypted = encryptSecret('x', KEY);
    const parts = encrypted.split(':');

    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = encryptSecret('secret', KEY);

    expect(() => decryptSecret(encrypted, OTHER_KEY)).toThrow();
  });

  it('fails to decrypt tampered ciphertext (GCM auth)', () => {
    const encrypted = encryptSecret('secret', KEY);
    // Flip the last hex char of the ciphertext segment.
    const parts = encrypted.split(':');
    const data = parts[2]!;
    const tamperedChar = data.at(-1) === 'a' ? 'b' : 'a';
    parts[2] = data.slice(0, -1) + tamperedChar;
    const tampered = parts.join(':');

    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('throws on a malformed stored value', () => {
    expect(() => decryptSecret('not-valid', KEY)).toThrow(/malformed/);
  });

  it('throws when the key is not 32 bytes', () => {
    expect(() => encryptSecret('x', 'short')).toThrow(/32 bytes/);
  });

  it('handles empty string plaintext', () => {
    const encrypted = encryptSecret('', KEY);
    expect(decryptSecret(encrypted, KEY)).toBe('');
  });

  it('handles unicode plaintext', () => {
    const plain = 'tokën-with-émoji-🔑';
    expect(decryptSecret(encryptSecret(plain, KEY), KEY)).toBe(plain);
  });
});
