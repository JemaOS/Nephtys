// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — authentification des payloads de GROUPE (Ed25519).
 *
 * Chaque membre d'un groupe possède une paire de signature **Ed25519** (même
 * primitive que la clé de signature du mode privé 1:1). Tout payload de
 * contrôle (`join`, `members`, `rotate`) est signé ; le récepteur vérifie la
 * signature AVANT d'appliquer un changement d'appartenance ou une rotation.
 *
 * Le sur-ensemble `(groupId, seq, from, payloadJson)` est signé : le `groupId`
 * empêche le rejeu d'un payload d'un groupe dans un autre, `seq` et `from`
 * lient la signature à une position et à un émetteur donnés.
 *
 * Module PUR (WebCrypto/noble seulement) → testable.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { base64ToBytes, bytesToBase64, randomBytes, utf8 } from '../ratchet/primitives';

export interface GroupSigningPair {
  privateKey: string; // base64 (seed Ed25519, 32 octets)
  publicKey: string;  // base64 (clé publique Ed25519)
}

export function generateGroupSigningPair(): GroupSigningPair {
  const seed = randomBytes(32);
  return { privateKey: bytesToBase64(seed), publicKey: bytesToBase64(ed25519.getPublicKey(seed)) };
}

function canonical(groupId: string, seq: number, from: string, payloadJson: string): Uint8Array {
  return utf8(`nephtys-group|${groupId}|${seq}|${from}|${payloadJson}`);
}

/** Signe un payload de groupe avec la clé privée Ed25519 de l'émetteur. */
export function signGroupPayload(
  groupId: string,
  seq: number,
  from: string,
  payloadJson: string,
  signingPrivateKeyB64: string,
): string {
  const signature = ed25519.sign(canonical(groupId, seq, from, payloadJson), base64ToBytes(signingPrivateKeyB64));
  return bytesToBase64(signature);
}

/** Vérifie la signature d'un payload de groupe avec la clé publique de l'émetteur. */
export function verifyGroupPayload(
  groupId: string,
  seq: number,
  from: string,
  payloadJson: string,
  signatureB64: string,
): boolean {
  try {
    return ed25519.verify(
      base64ToBytes(signatureB64),
      canonical(groupId, seq, from, payloadJson),
      base64ToBytes(from),
    );
  } catch {
    return false;
  }
}
