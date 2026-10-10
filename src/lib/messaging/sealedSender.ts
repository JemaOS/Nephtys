// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Sealed Sender — Phase 1 de « cacher le graphe au serveur » (option A).
 *
 * Objectif : le serveur (Supabase) ne doit plus apprendre **QUI** écrit à qui.
 * Aujourd'hui `messages.sender_id` est stocké en clair → le serveur connaît les
 * arêtes dirigées du graphe social.
 *
 * Principe (façon Signal *sealed sender*) : l'expéditeur scelle son identité
 * pour **chaque destinataire** avec la clé publique X25519 de ce destinataire,
 * via une paire éphémère + ECDH → HKDF → AES-GCM. Le serveur ne voit qu'un
 * `ephemeral_public_key` aléatoire par destinataire : il **ne peut pas** relier
 * un message à son émetteur.
 *
 *   seal   = version(1) || ephPub(32) || iv(12) || AES-GCM(eph, HKDF(x25519(ephPriv, recipientPub)), senderId)
 *
 * Module PUR (aucune dépendance Supabase/IndexedDB) → testable en isolation.
 *
 * @module sealedSender
 */

import { x25519 } from '@noble/curves/ed25519.js';
import { untagX25519 } from '../x25519';

const HKDF_INFO = 'nephtys-sealed-sender-v1';
const VERSION = 1;
const EPH_PUB_LEN = 32;
const IV_LEN = 12;
const HEADER_LEN = 1 + EPH_PUB_LEN + IV_LEN;

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

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ─── Dérivation AES (ECDH → HKDF → AES-256-GCM) ───────────────────────

async function deriveAesKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
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

// ─── Scellement / ouverture ───────────────────────────────────────────

/**
 * Scelle l'identité de l'expéditeur pour un destinataire.
 *
 * @param recipientPublicKey clé publique X25519 du destinataire (taguée `x25519:` ou brute)
 * @param senderId           identifiant de l'expéditeur à cacher au serveur
 * @returns base64 du blob scellé (opaque pour le serveur)
 */
export async function sealSenderForRecipient(
  recipientPublicKey: string,
  senderId: string,
): Promise<string> {
  const ephPriv = crypto.getRandomValues(new Uint8Array(32));
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, fromBase64(untagX25519(recipientPublicKey)));
  const key = await deriveAesKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(senderId),
  );
  return toBase64(concat(Uint8Array.of(VERSION), ephPub, iv, new Uint8Array(ct)));
}

/**
 * Ouvre un blob scellé avec la clé privée du destinataire.
 * Throws si le blob n'est pas destiné à cette clé (ou est altéré).
 */
export async function openSealedSender(
  myPrivateKeyB64: string,
  blob: string,
): Promise<string> {
  const bytes = fromBase64(blob);
  if (bytes.length < HEADER_LEN + 1) throw new Error('sealed sender: blob trop court');
  if (bytes[0] !== VERSION) throw new Error('sealed sender: version non supportée');
  const ephPub = bytes.slice(1, 1 + EPH_PUB_LEN);
  const iv = bytes.slice(1 + EPH_PUB_LEN, HEADER_LEN);
  const ct = bytes.slice(HEADER_LEN);

  const shared = x25519.getSharedSecret(fromBase64(myPrivateKeyB64), ephPub);
  const key = await deriveAesKey(shared);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

/**
 * Tente d'ouvrir, parmi plusieurs blobs scellés, celui destiné à `myPrivateKeyB64`.
 * Le serveur stocke un blob par destinataire ; chacun essaie jusqu'à trouver le sien.
 * Retourne `null` si aucun ne correspond.
 */
export async function findMySealedSender(
  myPrivateKeyB64: string,
  blobs: string[],
): Promise<string | null> {
  for (const blob of blobs) {
    try {
      return await openSealedSender(myPrivateKeyB64, blob);
    } catch {
      // pas le bon blob : on essaie le suivant
    }
  }
  return null;
}

/**
 * Scelle l'identité de l'expéditeur pour tous les membres d'une conversation.
 * Retourne un blob par destinataire (l'expéditeur inclus pour relire ses envois).
 * Le serveur stocke la liste sans pouvoir associer un blob à un membre.
 */
export async function sealSenderForMembers(
  memberPublicKeys: string[],
  senderId: string,
): Promise<string[]> {
  return Promise.all(memberPublicKeys.map(pk => sealSenderForRecipient(pk, senderId)));
}
