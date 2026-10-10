// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * KEM post-quantique (ML-KEM-768, anciennement Kyber) — brique « hybride »
 * pour rendre l'échange de clés E2EE résistant aux ordinateurs quantiques
 * (comme Signal / SimpleX).
 *
 * Utilisé en **hybride** avec X25519 : le secret final combine les deux
 * (si l'un tombe, l'autre protège encore). Module pur, testable.
 *
 * @module pqKem
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';

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

export interface MlKemKeyPair {
  publicKey: string; // base64
  secretKey: string; // base64
}

/** Génère une paire ML-KEM-768. */
export function generateMlKemKeyPair(): MlKemKeyPair {
  const { publicKey, secretKey } = ml_kem768.keygen();
  return { publicKey: toBase64(publicKey), secretKey: toBase64(secretKey) };
}

/** Encapsule un secret partagé vers la clé publique d'un destinataire. */
export function mlKemEncapsulate(recipientPublicKeyB64: string): {
  cipherText: string;
  sharedSecret: string;
} {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(fromBase64(recipientPublicKeyB64));
  return { cipherText: toBase64(cipherText), sharedSecret: toBase64(sharedSecret) };
}

/** Décapsule le secret partagé avec la clé secrète du destinataire. */
export function mlKemDecapsulate(cipherTextB64: string, secretKeyB64: string): string {
  const shared = ml_kem768.decapsulate(fromBase64(cipherTextB64), fromBase64(secretKeyB64));
  return toBase64(shared);
}
