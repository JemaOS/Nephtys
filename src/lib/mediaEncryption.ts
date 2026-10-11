// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Chiffrement E2EE des médias — **helpers AES-256-GCM purs**.
 *
 * Le wrapping de la clé AES par destinataire se fait désormais en **X25519**
 * (cf. `x25519.ts` + `encryptedMediaService.ts`). Ce module ne contient plus
 * aucune gestion de clés ECDH : uniquement le chiffrement AES du binaire et
 * les conversions base64.
 */

const AES_PARAMS: AesKeyAlgorithm = { name: 'AES-GCM', length: 256 };

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface EncryptedMediaPayload {
  /** Binaire chiffré du média à uploader */
  ciphertext: Uint8Array;
  /** Clé AES brute (32 bytes) à envelopper pour chaque destinataire */
  rawKey: Uint8Array;
  /** IV utilisé pour le chiffrement (12 bytes) */
  iv: Uint8Array;
}

/** Chiffre un fichier (Blob/File/ArrayBuffer) avec une clé AES-256 aléatoire. */
export async function encryptMedia(file: Blob | ArrayBuffer): Promise<EncryptedMediaPayload> {
  const buffer = file instanceof Blob ? await file.arrayBuffer() : file;

  const key = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer),
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  return { ciphertext, rawKey, iv };
}

/** Déchiffre un binaire avec la clé AES brute fournie. */
export async function decryptMedia(
  ciphertext: ArrayBuffer | Uint8Array,
  rawKey: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', rawKey, AES_PARAMS, false, ['decrypt']);
  const buf = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, buf);
  return new Uint8Array(plain);
}

export interface WrappedKey {
  encryptedKey: string; // base64
  iv: string; // base64
  senderPublicKey: string;
}

/** Conversions base64 ↔ buffer pour usage externe. */
export const cryptoB64 = {
  toBase64: bufToBase64,
  fromBase64: base64ToBuf,
};
