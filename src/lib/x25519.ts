// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Cryptographie X25519 (curve25519) pour l'échange de clés E2EE.
 *
 * Remplace progressivement la pile ECDH P-256 (cf. `mediaEncryption.ts`),
 * qui n'offre pas les mêmes garanties et alourdit l'empreinte des clés.
 *
 * Module PUR (aucune dépendance Supabase/IndexedDB) → testable en isolation.
 *
 * Schéma :
 *   • Paire X25519 : clé privée 32 octets, clé publique 32 octets (base64).
 *   • La clé publique publiée est taguée `x25519:<base64>` afin de cohabiter
 *     avec les anciennes clés P-256 (SPKI base64 non taguées) et d'être
 *     détectable sans ambiguïté.
 *   • Accord de clé : X25519 (via @noble/curves) → HKDF-SHA256 → clé AES-256-GCM.
 *
 * ⚠️ La clé privée X25519 brute n'est jamais publiée : seul le matériel
 * chiffré par passphrase (cf. `e2eeX25519.ts`) l'est.
 */

import { x25519, ed25519 } from '@noble/curves/ed25519.js';

export const X25519_PREFIX = 'x25519:';
const HKDF_INFO = 'nephtys-x25519-v1';

// ─── base64 ───────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ─── Tague / détague les clés publiques ───────────────────────────────

/** Une clé publique est-elle au format X25519 (taguée) ? */
export function isX25519PublicKey(publicKey: string | null | undefined): boolean {
  return typeof publicKey === 'string' && publicKey.startsWith(X25519_PREFIX);
}

/** Ajoute le tag X25519 si absent. */
export function tagX25519(publicKeyB64: string): string {
  return isX25519PublicKey(publicKeyB64) ? publicKeyB64 : X25519_PREFIX + publicKeyB64;
}

/** Retire le tag X25519 s'il est présent. */
export function untagX25519(publicKey: string): string {
  return isX25519PublicKey(publicKey) ? publicKey.slice(X25519_PREFIX.length) : publicKey;
}

// ─── Paires de clés ───────────────────────────────────────────────────

export interface X25519KeyPair {
  /** Clé publique base64 (taguée `x25519:`) */
  publicKey: string;
  /** Clé privée base64 (32 octets bruts) */
  privateKey: string;
}

/** Génère une nouvelle paire X25519. */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = crypto.getRandomValues(new Uint8Array(32));
  const publicKey = x25519.getPublicKey(privateKey);
  return { publicKey: tagX25519(toBase64(publicKey)), privateKey: toBase64(privateKey) };
}

/** Recalcule la clé publique (taguée) à partir de la clé privée. */
export function deriveX25519PublicKey(privateKeyB64: string): string {
  const publicKey = x25519.getPublicKey(fromBase64(privateKeyB64));
  return tagX25519(toBase64(publicKey));
}

// ─── Signature de la clé publique X25519 (anti-MITM) ──────────────────

const X25519_KEY_SIG_CONTEXT = 'nephtys-x25519-key-v1';

function sigData(x25519PublicKey: string): Uint8Array {
  const ctx = new TextEncoder().encode(X25519_KEY_SIG_CONTEXT);
  const key = new TextEncoder().encode(x25519PublicKey);
  const out = new Uint8Array(ctx.length + key.length);
  out.set(ctx, 0);
  out.set(key, ctx.length);
  return out;
}

/**
 * Signe la clé publique X25519 (taguée) avec une clé privée Ed25519 (seed 32 o
 * base64). La signature lie la clé X25519 au porteur de la clé de signature.
 */
export function signX25519PublicKey(signingPrivateKeyB64: string, x25519PublicKey: string): string {
  const signature = ed25519.sign(sigData(x25519PublicKey), fromBase64(signingPrivateKeyB64));
  return toBase64(signature);
}

/** Vérifie la signature Ed25519 d'une clé publique X25519. */
export function verifyX25519PublicKeySignature(
  signingPublicKeyB64: string,
  x25519PublicKey: string,
  signatureB64: string,
): boolean {
  try {
    return ed25519.verify(fromBase64(signatureB64), sigData(x25519PublicKey), fromBase64(signingPublicKeyB64));
  } catch {
    return false;
  }
}

// ─── Dérivation de la clé AES partagée ────────────────────────────────

async function deriveSharedAesKey(
  myPrivateKeyB64: string,
  theirPublicKey: string,
): Promise<CryptoKey> {
  const sharedSecret = x25519.getSharedSecret(
    fromBase64(myPrivateKeyB64),
    fromBase64(untagX25519(theirPublicKey)),
  );

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecret as BufferSource,
    'HKDF',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── Wrap / Unwrap (mêmes structures que la pile P-256) ───────────────

export interface X25519WrappedKey {
  encryptedKey: string;
  iv: string;
  senderPublicKey: string;
}

/**
 * AAD des enveloppes de clé : lie le ciphertext à la clé publique de
 * l'expéditeur déclarée. Empêche de rejouer une enveloppe sous une autre clé
 * d'expéditeur. Rétrocompatible : les enveloppes historiques SANS AAD restent
 * déchiffrables (repli dans `unwrapKeyFromSenderX25519`).
 */
export const KEYWRAP_AAD_PREFIX = 'nephtys-keywrap-v1|';

export function keyWrapAad(senderPublicKey: string): string {
  return `${KEYWRAP_AAD_PREFIX}${senderPublicKey}`;
}

/** Enveloppe une clé AES brute pour un destinataire via X25519. */
export async function wrapKeyForRecipientX25519(
  rawKey: Uint8Array,
  senderPrivateKeyB64: string,
  senderPublicKey: string,
  recipientPublicKey: string,
  aad?: string,
): Promise<X25519WrappedKey> {
  const sharedKey = await deriveSharedAesKey(senderPrivateKeyB64, recipientPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as BufferSource;
  const encrypted = await crypto.subtle.encrypt(
    params,
    sharedKey,
    rawKey as BufferSource,
  );
  return {
    encryptedKey: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    senderPublicKey,
  };
}

/** Déchiffre une clé enveloppée X25519. */
export async function unwrapKeyFromSenderX25519(
  wrapped: X25519WrappedKey,
  myPrivateKeyB64: string,
  aad?: string,
): Promise<Uint8Array> {
  const sharedKey = await deriveSharedAesKey(myPrivateKeyB64, wrapped.senderPublicKey);
  const iv = fromBase64(wrapped.iv) as BufferSource;
  const ct = fromBase64(wrapped.encryptedKey) as BufferSource;

  if (aad) {
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) as BufferSource },
        sharedKey,
        ct,
      );
      return new Uint8Array(plain);
    } catch {
      // Repli : enveloppe historique émise SANS AAD.
    }
  }

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    sharedKey,
    ct,
  );
  return new Uint8Array(plain);
}
