// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Primitives cryptographiques du Double Ratchet / X3DH.
 *
 * Module PUR (aucune dépendance réseau) → entièrement testable.
 *   • DH curve25519  : @noble/curves (Node n'expose pas X25519 via WebCrypto)
 *   • HKDF-SHA256    : WebCrypto
 *   • HMAC-SHA256    : WebCrypto (KDF de chaîne, style Signal)
 *   • AEAD           : AES-256-GCM WebCrypto
 */

import { x25519 } from '@noble/curves/ed25519.js';

// ─── encodage / aléa ──────────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// ─── échange de clés (X25519) ─────────────────────────────────────────

export interface RawKeyPair {
  privateKey: string; // base64 (32 octets)
  publicKey: string;  // base64 (32 octets)
}

export function generateX25519KeyPair(): RawKeyPair {
  const priv = randomBytes(32);
  return { privateKey: bytesToBase64(priv), publicKey: bytesToBase64(x25519.getPublicKey(priv)) };
}

export function x25519PublicFromPrivate(privateKeyB64: string): string {
  return bytesToBase64(x25519.getPublicKey(base64ToBytes(privateKeyB64)));
}

/** DH(privA, pubB) → secret partagé brut (32 octets). */
export function dh(privateKeyB64: string, publicKeyB64: string): Uint8Array {
  return x25519.getSharedSecret(base64ToBytes(privateKeyB64), base64ToBytes(publicKeyB64));
}

// ─── HKDF / HMAC (WebCrypto) ──────────────────────────────────────────

export async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  length = 32,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data as BufferSource);
  return new Uint8Array(sig);
}

// ─── KDF du Double Ratchet ────────────────────────────────────────────

/** KDF_RK : (rootKey, DH out) → (nouvelle rootKey, nouvelle chainKey). */
export async function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array,
): Promise<[Uint8Array, Uint8Array]> {
  const out = await hkdf(dhOutput, rootKey, 'NephtysRatchetRoot', 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

/** KDF_CK : chainKey → (chainKey suivante, messageKey). */
export async function kdfChainKey(chainKey: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
  const next = await hmacSha256(chainKey, new Uint8Array([0x02]));
  const messageKey = await hmacSha256(chainKey, new Uint8Array([0x01]));
  return [next, messageKey];
}

// ─── AEAD (AES-256-GCM) ───────────────────────────────────────────────

export async function aeadEncrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
  associatedData: Uint8Array,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const iv = randomBytes(12);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: associatedData as BufferSource },
      cryptoKey,
      plaintext as BufferSource,
    ),
  );
  return { iv, ciphertext };
}

export async function aeadDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  associatedData: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: associatedData as BufferSource },
    cryptoKey,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plaintext);
}
