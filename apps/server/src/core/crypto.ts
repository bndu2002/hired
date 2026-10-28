/**
 * Symmetric encryption for secrets at rest (Gmail OAuth tokens).
 *
 * AES-256-GCM. The key comes from TOKEN_ENCRYPTION_KEY (64 hex chars = 32
 * bytes). GCM gives us authenticated encryption — tampering with the
 * ciphertext fails decryption loudly rather than returning garbage.
 *
 * Storage format (single string, so it fits one TEXT column):
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * This lives in core/ and is pure (no I/O, no DB) — just transforms strings.
 * The key is passed IN by callers rather than read from config here, so the
 * function stays testable without env and core/ keeps its no-config purity.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM recommendation
const KEY_BYTES = 32; // AES-256

/** Parse the 64-hex-char key string into a 32-byte Buffer. Throws if malformed. */
function keyBuffer(keyHex: string): Buffer {
  const buf = Buffer.from(keyHex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `encryption key must be ${KEY_BYTES} bytes (${KEY_BYTES * 2} hex chars), got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Encrypt a UTF-8 plaintext string. Returns `iv:authTag:ciphertext`, all hex.
 * A fresh random IV per call means encrypting the same token twice yields
 * different ciphertext — correct GCM usage.
 */
export function encryptSecret(plaintext: string, keyHex: string): string {
  const key = keyBuffer(keyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypt a string produced by encryptSecret. Throws if the format is wrong,
 * the key is wrong, or the ciphertext/tag was tampered with.
 */
export function decryptSecret(stored: string, keyHex: string): string {
  const key = keyBuffer(keyHex);
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('encrypted value is malformed (expected iv:tag:ciphertext)');
  }
  const [ivHex, tagHex, dataHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  return plaintext.toString('utf8');
}
