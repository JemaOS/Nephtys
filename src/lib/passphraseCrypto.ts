// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Primitives crypto pures (sans dépendance Supabase) pour le chiffrement de la
 * clé privée par passphrase. Partagées entre le thread principal et le Web
 * Worker `src/workers/pbkdf2.worker.ts`.
 *
 * PBKDF2-SHA256, 310 000 itérations (OWASP), sel 16 o, AES-GCM 256, IV 12 o.
 */

export const PBKDF2_ITERATIONS = 310_000;
export const PBKDF2_HASH = 'SHA-256';
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;

export interface EncryptedPrivateKey {
  encryptedPrivateKey: string; // base64
  salt: string;                // base64 (16 bytes)
  iv: string;                  // base64 (12 bytes)
}

export function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function encodePassphrase(passphrase: string, form: 'NFC' | 'NFD' | 'raw'): Uint8Array {
  const enc = new TextEncoder();
  try {
    return enc.encode(form === 'raw' ? passphrase : passphrase.normalize(form));
  } catch {
    return enc.encode(passphrase);
  }
}

export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  form: 'NFC' | 'NFD' | 'raw' = 'NFC',
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encodePassphrase(passphrase, form),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Chiffre une clé privée (PKCS8 base64) avec une passphrase (sel/IV aléatoires). */
export async function encryptPrivateKeyRaw(
  privateKeyPkcs8Base64: string,
  passphrase: string,
): Promise<EncryptedPrivateKey> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const aesKey = await deriveKeyFromPassphrase(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    aesKey,
    base64ToBuf(privateKeyPkcs8Base64),
  );

  return {
    encryptedPrivateKey: bufToBase64(encrypted),
    salt: bufToBase64(salt.buffer as ArrayBuffer),
    iv: bufToBase64(iv.buffer as ArrayBuffer),
  };
}

/** Déchiffre (throws si passphrase incorrecte — AES-GCM lève une erreur).
 *  Multi-appareil : on essaie NFC, puis NFD, puis la forme brute, car un même
 *  mot de passe tapé sur Windows (NFC) vs macOS/iOS (NFD) produit des octets
 *  différents → clé PBKDF2 différente → échec de déchiffrement sur l'autre
 *  appareil. Ces essais rendent la restauration robuste quel que soit l'appareil. */
export async function decryptPrivateKeyRaw(
  encrypted: EncryptedPrivateKey,
  passphrase: string,
): Promise<string /* PKCS8 base64 */> {
  const salt = new Uint8Array(base64ToBuf(encrypted.salt));
  const iv = new Uint8Array(base64ToBuf(encrypted.iv));

  const forms: Array<'NFC' | 'NFD' | 'raw'> = ['NFC', 'NFD', 'raw'];
  let lastErr: unknown;
  for (const form of forms) {
    try {
      const aesKey = await deriveKeyFromPassphrase(passphrase, salt, form);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource },
        aesKey,
        base64ToBuf(encrypted.encryptedPrivateKey),
      );
      return bufToBase64(decrypted);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('decrypt failed');
}
