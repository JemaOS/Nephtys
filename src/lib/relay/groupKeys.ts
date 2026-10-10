// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Mode privé — clés de groupe (« Sender Keys » simplifiées, par époque).
 *
 * Modèle :
 *   • Un groupe possède une **clé symétrique par « époque »** (AES-256-GCM).
 *   • Chaque message porte son numéro d'époque ; le récepteur déchiffre avec
 *     la clé de cette époque (il conserve les époques récentes).
 *   • À chaque **changement de membres** (ajout/retrait), on **tourne** la clé :
 *     nouvelle époque + nouvelle clé, distribuée aux membres restants. Un
 *     membre retiré ne reçoit pas la nouvelle clé → il ne peut plus lire.
 *
 * Module PUR (WebCrypto seulement) → testable en isolation.
 */

import { base64ToBytes, bytesToBase64, randomBytes, utf8 } from '../ratchet/primitives';

export interface GroupEpochKeys {
  groupId: string;
  currentEpoch: number;
  /** époque (string) → clé AES-256 base64 */
  keys: Record<string, string>;
}

async function importAes(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function groupAd(groupId: string, epoch: number): Uint8Array {
  return utf8(`${groupId}|${epoch}`);
}

// ─── Cycle de vie des époques ─────────────────────────────────────────

/** Nouvel état de groupe + la clé de l'époque 0. */
export function createGroupKeys(groupId: string): { state: GroupEpochKeys; keyB64: string } {
  const keyB64 = bytesToBase64(randomBytes(32));
  return {
    state: { groupId, currentEpoch: 0, keys: { '0': keyB64 } },
    keyB64,
  };
}

/** Rotation : nouvelle époque + nouvelle clé (ajout/retrait de membre). */
export function rotateGroupKeys(state: GroupEpochKeys): { state: GroupEpochKeys; keyB64: string } {
  const nextEpoch = state.currentEpoch + 1;
  const keyB64 = bytesToBase64(randomBytes(32));
  return {
    state: { ...state, currentEpoch: nextEpoch, keys: { ...state.keys, [String(nextEpoch)]: keyB64 } },
    keyB64,
  };
}

/** Enregistre une clé reçue pour une époque donnée (distribution hors-bande). */
export function addEpochKey(state: GroupEpochKeys, epoch: number, keyB64: string): GroupEpochKeys {
  return {
    ...state,
    currentEpoch: Math.max(state.currentEpoch, epoch),
    keys: { ...state.keys, [String(epoch)]: keyB64 },
  };
}

/** Ne garde que les N époques les plus récentes (borne mémoire). */
export function pruneEpochKeys(state: GroupEpochKeys, keep = 5): GroupEpochKeys {
  const epochs = Object.keys(state.keys)
    .map(Number)
    .sort((a, b) => b - a)
    .slice(0, keep);
  const keys: Record<string, string> = {};
  for (const e of epochs) keys[String(e)] = state.keys[String(e)];
  return { ...state, keys };
}

export function serializeGroupKeys(state: GroupEpochKeys): string {
  return JSON.stringify(state);
}

export function deserializeGroupKeys(json: string): GroupEpochKeys {
  return JSON.parse(json) as GroupEpochKeys;
}

// ─── Chiffrement / déchiffrement ──────────────────────────────────────

export interface GroupMessage {
  epoch: number;
  iv: string;
  ct: string;
}

export async function encryptGroupMessage(
  groupId: string,
  epoch: number,
  keyB64: string,
  plaintext: string,
): Promise<GroupMessage> {
  const key = await importAes(base64ToBytes(keyB64));
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: groupAd(groupId, epoch) as BufferSource },
      key,
      utf8(plaintext) as BufferSource,
    ),
  );
  return { epoch, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

export async function decryptGroupMessage(
  state: GroupEpochKeys,
  epoch: number,
  ivB64: string,
  ctB64: string,
): Promise<string> {
  const keyB64 = state.keys[String(epoch)];
  if (!keyB64) throw new Error(`group: époque ${epoch} inconnue (clé manquante)`);
  const key = await importAes(base64ToBytes(keyB64));
  const pt = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(ivB64) as BufferSource,
      additionalData: groupAd(state.groupId, epoch) as BufferSource,
    },
    key,
    base64ToBytes(ctB64) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}
