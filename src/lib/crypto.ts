/**
 * AES-GCM encryption utilities for API key storage.
 * Keys are encrypted before writing to localStorage to avoid plaintext exposure.
 * Because the derived key material originates from a fixed salt in the same
 * origin, the primary goal is obfuscation rather than strong confidentiality.
 */

const SALT = 'cooktalk-v1-salt-2026';
const STORAGE_PREFIX = 'ct_key_';

type ApiKeyName =
  | 'elevenlabs'
  | 'llm'
  | 'llm-endpoint'
  | 'llm-model'
  | 'imagegen-endpoint'
  | 'imagegen-key'
  | 'imagegen-model';

// ── Internal crypto helpers ──────────────────────────────────────────────────

async function deriveKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(SALT),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('cooktalk-aes-gcm'),
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Encrypt a UTF-8 plaintext string.
 * Returns a base64-encoded string of the format: `<iv_b64>:<ciphertext_b64>`.
 */
export async function encryptData(plaintext: string): Promise<string> {
  const key = await deriveKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  return `${bufferToBase64(iv.buffer as ArrayBuffer)}:${bufferToBase64(ciphertext)}`;
}

/**
 * Decrypt a string produced by `encryptData`.
 */
export async function decryptData(ciphertext: string): Promise<string> {
  const [ivB64, dataB64] = ciphertext.split(':');
  if (!ivB64 || !dataB64) {
    throw new Error('Invalid ciphertext format');
  }
  const key = await deriveKey();
  const iv = base64ToBuffer(ivB64).buffer as ArrayBuffer;
  const data = base64ToBuffer(dataB64).buffer as ArrayBuffer;
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data,
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt and persist an API key value to localStorage.
 */
export async function storeApiKey(key: ApiKeyName, value: string): Promise<void> {
  const encrypted = await encryptData(value);
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, encrypted);
}

/**
 * Retrieve and decrypt an API key from localStorage.
 * Returns `null` when the key is not present.
 */
export async function getApiKey(key: ApiKeyName): Promise<string | null> {
  const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`);
  if (!raw) return null;
  try {
    return await decryptData(raw);
  } catch {
    // Corrupted entry – remove it so the user can re-enter
    localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
    return null;
  }
}

/**
 * Remove an API key from localStorage.
 */
export async function removeApiKey(key: ApiKeyName): Promise<void> {
  localStorage.removeItem(`${STORAGE_PREFIX}${key}`);
}

/**
 * Synchronous check: returns true if the key exists in localStorage
 * (does not verify that the stored value can be successfully decrypted).
 */
export function hasApiKey(key: ApiKeyName): boolean {
  return localStorage.getItem(`${STORAGE_PREFIX}${key}`) !== null;
}
