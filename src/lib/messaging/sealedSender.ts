// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Sealed Sender — Phase 1 de « cacher le graphe au serveur » (option A).
 *
 * Objectif : le serveur (Supabase) ne doit plus apprendre **QUI** écrit à qui.
 *
 * Principe (façon Signal *sealed sender*) : l'expéditeur scelle son identité
 * pour **chaque destinataire** avec la clé publique X25519 de ce destinataire,
 * via une paire éphémère + ECDH → HKDF → AES-GCM. Le serveur ne voit qu'une
 * clé publique éphémère aléatoire par destinataire : il **ne peut pas** relier
 * un message à son émetteur.
 *
 *    seal = version(1) || ephPub(32) || iv(12) || AES-GCM(payload)
 *
 * ⚠️ AUTHENTIFICATION (anti-usurpation) : le payload est **signé Ed25519** par
 * la clé de signature de l'expéditeur. Sans cela, n'importe qui pourrait
 * sceller l'identifiant d'un autre. Le destinataire **vérifie** la signature
 * avec la clé publique de signature publiée de l'expéditeur (`ratchet_signing_key`).
 *
 *   payload signé = JSON { v:2, s: senderId, sig: base64(Ed25519(sigMsg)) }
 *   sigMsg        = "nephtys-sealed-sender-sig-v1|" + senderId
 *
 * Module PUR (aucune dépendance Supabase/IndexedDB) → testable en isolation.
 *
 * @module sealedSender
 */

import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { untagX25519 } from '../x25519';

const HKDF_INFO = 'nephtys-sealed-sender-v1';
const SIG_DOMAIN = 'nephtys-sealed-sender-sig-v1';
const BOX_VERSION = 1;
const PAYLOAD_VERSION = 2;
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

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
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
      info: utf8(HKDF_INFO),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ─── Signature du payload ─────────────────────────────────────────────

function sigMessage(senderId: string): Uint8Array {
  return utf8(`${SIG_DOMAIN}|${senderId}`);
}

// ─── Scellement ───────────────────────────────────────────────────────

/**
 * Scelle l'identité de l'expéditeur pour un destinataire.
 *
 * @param recipientPublicKey clé publique X25519 du destinataire (taguée ou brute)
 * @param senderId           identifiant de l'expéditeur à cacher au serveur
 * @param signingPrivateKey  clé privée Ed25519 de l'expéditeur (authentifie le scellé)
 * @returns base64 du blob scellé (opaque pour le serveur)
 */
export async function sealSenderForRecipient(
  recipientPublicKey: string,
  senderId: string,
  signingPrivateKey: string,
): Promise<string> {
  const signature = ed25519.sign(sigMessage(senderId), fromBase64(signingPrivateKey));
  const payload = JSON.stringify({
    v: PAYLOAD_VERSION,
    s: senderId,
    sig: toBase64(signature),
  });

  const ephPriv = crypto.getRandomValues(new Uint8Array(32));
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, fromBase64(untagX25519(recipientPublicKey)));
  const key = await deriveAesKey(shared);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    utf8(payload) as BufferSource,
  );
  return toBase64(concat(Uint8Array.of(BOX_VERSION), ephPub, iv, new Uint8Array(ct)));
}

/**
 * Ouvre un blob scellé avec la clé privée du destinataire et renvoie le
 * **payload brut** (chaîne). La vérification de signature est faite par
 * `verifySealedSender` / `findVerifiedSender`.
 * Throws si le blob n'est pas destiné à cette clé (ou est altéré).
 */
export async function openSealedSender(
  myPrivateKeyB64: string,
  blob: string,
): Promise<string> {
  const bytes = fromBase64(blob);
  if (bytes.length < HEADER_LEN + 1) throw new Error('sealed sender: blob trop court');
  if (bytes[0] !== BOX_VERSION) throw new Error('sealed sender: version non supportée');
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

// ─── Vérification ─────────────────────────────────────────────────────

export interface SealedSenderPayload {
  senderId: string;
  signature: string;
}

/** Parse un payload signé (v2). Retourne null si legacy/non signé. */
export function parseSealedSenderPayload(raw: string): SealedSenderPayload | null {
  try {
    const o = JSON.parse(raw);
    if (o && o.v === PAYLOAD_VERSION && typeof o.s === 'string' && typeof o.sig === 'string') {
      return { senderId: o.s, signature: o.sig };
    }
  } catch {
    // payload legacy (identifiant en clair, non signé)
  }
  return null;
}

/** Vérifie la signature Ed25519 du payload avec la clé publique de l'expéditeur. */
export function verifySealedSender(
  payload: SealedSenderPayload,
  signingPublicKey: string,
): boolean {
  try {
    return ed25519.verify(
      fromBase64(payload.signature),
      sigMessage(payload.senderId),
      fromBase64(signingPublicKey),
    );
  } catch {
    return false;
  }
}

/**
 * Retrouve l'expéditeur **authentifié** parmi des blobs scellés.
 * Pour chaque blob ouvrable, on parse le payload signé puis on **vérifie** la
 * signature avec la clé publique de l'expéditeur revendiqué (`getSigningKey`).
 * Un payload non signé (legacy) est ignoré → retour `null` (repli sender_id).
 * → Empêche l'usurpation : sceller l'id d'un autre échoue à la vérification.
 */
export async function findVerifiedSender(
  myPrivateKeyB64: string,
  blobs: string[],
  getSigningKey: (senderId: string) => Promise<string | null>,
): Promise<string | null> {
  for (const blob of blobs) {
    let raw: string;
    try {
      raw = await openSealedSender(myPrivateKeyB64, blob);
    } catch {
      continue; // pas le bon blob
    }
    const payload = parseSealedSenderPayload(raw);
    if (!payload) continue; // non authentifié → ignoré
    const signingKey = await getSigningKey(payload.senderId);
    if (!signingKey) continue;
    if (verifySealedSender(payload, signingKey)) return payload.senderId;
  }
  return null;
}

/** Scelle l'identité pour tous les membres (un blob chacun). */
export async function sealSenderForMembers(
  memberPublicKeys: string[],
  senderId: string,
  signingPrivateKey: string,
): Promise<string[]> {
  return Promise.all(
    memberPublicKeys.map(pk => sealSenderForRecipient(pk, senderId, signingPrivateKey)),
  );
}
