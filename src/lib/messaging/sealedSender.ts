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
 * ⚠️ REJEU (v3) : la signature v2 ne couvre QUE `senderId`. Un membre peut donc
 * recopier le blob scellé d'Alice dans un **nouveau** message et se faire passer
 * pour elle. La **v3** lie la signature au CONTEXTE du message :
 *
 *   payload signé = JSON { v:3, s: senderId, sig: base64(Ed25519(sigMsg)) }
 *   sigMsg        = "nephtys-sealed-sender-v3|" + conversationId + "|"
 *                   + messageId + "|" + sha256hex(content)
 *
 * `sha256(content)` porte sur le champ `messages.content` stocké (ciphertext
 * pour le texte, texte de légende pour un média, "" sinon). Un blob v3 recopié
 * sur un autre message (id / conversation / contenu différent) échoue donc à la
 * vérification → l'expéditeur usurpé n'est PAS attribué.
 *
 * ⚠️ CLÉS D'IDENTITÉ NON LIÉES (v3 → v4) : la v3 transporte `xk` (clé X25519 de
 * l'expéditeur) et `ik` (clé d'identité ratchet) DANS le payload scellé, mais sa
 * signature ne les couvre PAS : un membre malveillant qui peut ré-émettre un
 * blob vers le destinataire peut garder la signature valide et substituer `xk`/
 * `ik`. La **v4** couvre AUSSI ces clés :
 *
 *   payload signé = JSON { v:4, s: senderId, sig, xk, ik }
 *   sigMsg        = "nephtys-sealed-sender-v4|" + conversationId + "|"
 *                   + messageId + "|" + sha256hex(content) + "|" + xk + "|" + ik
 *
 * Une v4 dont `xk`/`ik` a été modifié échoue à la vérification. La lecture des
 * v3 (déjà publiées, clés non couvertes) et v2 reste assurée (rétrocompatibilité
 * de l'historique) ; seules les nouvelles émissions sont en v4.
 *
 * ⚠️ BASCULE v2 → v3/v4 (`V2_SUNSET_ISO`) : la v2 n'est pas liée au message,
 * donc REJOUABLE (un membre peut recopier le scellé d'un autre dans un nouveau
 * message). Un message dont `created_at` est ≥ la bascule REFUSE un blob v2 (ou
 * sans `v`, considéré comme v2) : l'expéditeur n'est PAS attribué. Les messages
 * ANTÉRIEURS restent lus via la v2 (rétrocompatibilité de l'historique).
 * FAIL-CLOSED : si `created_at` est ABSENT ou illisible, on ne peut PAS prouver
 * que le message précède la bascule → la v2 est également REFUSÉE. L'appelant
 * active ce refus par `resolveSealedSenders`, qui calcule
 * `rejectUnboundV2: shouldRejectUnboundV2(created_at)` ; les requêtes qui
 * alimentent ce chemin DOIVENT donc sélectionner `created_at`.
 *
 * Module PUR (aucune dépendance Supabase/IndexedDB) → testable en isolation.
 *
 * @module sealedSender
 */

import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { untagX25519 } from '../x25519';

const HKDF_INFO = 'nephtys-sealed-sender-v1';
const SIG_DOMAIN_V2 = 'nephtys-sealed-sender-sig-v1';
const SIG_DOMAIN_V3 = 'nephtys-sealed-sender-v3';
const SIG_DOMAIN_V4 = 'nephtys-sealed-sender-v4';
const BOX_VERSION = 1;
const PAYLOAD_VERSION_V2 = 2;
const PAYLOAD_VERSION_V3 = 3;
const PAYLOAD_VERSION_V4 = 4;
const EPH_PUB_LEN = 32;
const IV_LEN = 12;
const HEADER_LEN = 1 + EPH_PUB_LEN + IV_LEN;

/**
 * Date de bascule v2 → v3 du sealed sender.
 *
 * Un message dont `created_at` est ≥ à cette date ne doit plus accepter les
 * blobs v2 (ou sans `v`) : non liés au contexte du message, ils sont rejouables
 * (un membre peut recopier le scellé d'Alice dans un nouveau message). À partir
 * de cette date, un tel blob n'attribue PAS l'expéditeur ; les messages
 * antérieurs restent résolus en v2 (lecture de l'historique).
 *
 * Configurable via `VITE_SEALED_V2_SUNSET` (ISO 8601). Le **défaut est la date
 * de mise en service de la v3** (`2026-10-12T00:00:00Z`) : tout message créé à
 * partir de cette date refuse les blobs v2, ce qui ferme effectivement le rejeu
 * (un défaut dans le futur laisserait la v2 acceptée partout jusque-là).
 */
export const V2_SUNSET_ISO =
  (import.meta.env.VITE_SEALED_V2_SUNSET as string | undefined) ?? '2026-10-12T00:00:00Z';

/**
 * `createdAt` correspond-il à un message créé à/après la bascule v2 ?
 * `false` si la date est absente ou illisible (cette fonction répond à la seule
 * question « est-ce PROUVÉ après la bascule ? »). Pour la DÉCISION d'accepter un
 * blob v2, utiliser `shouldRejectUnboundV2` (fail-closed sur date inconnue).
 */
export function isAfterV2Sunset(createdAt: string | null | undefined): boolean {
  if (typeof createdAt !== 'string' || createdAt.length === 0) return false;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return false;
  return t >= Date.parse(V2_SUNSET_ISO);
}

/**
 * Faut-il REFUSER un blob v2 (non lié au message, donc rejouable) pour un
 * message donné ?
 *
 * FAIL-CLOSED : refuse si le message est à/après la bascule, MAIS AUSSI si la
 * date est ABSENTE ou illisible — on ne peut pas prouver que le message précède
 * la bascule, donc on n'accepte pas la v2. Les appelants doivent sélectionner
 * `created_at` dans leurs requêtes pour que l'historique réel reste résolu.
 */
export function shouldRejectUnboundV2(createdAt: string | null | undefined): boolean {
  if (typeof createdAt !== 'string' || createdAt.trim() === '') return true;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return true;
  return t >= Date.parse(V2_SUNSET_ISO);
}

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

// ─── Contexte du message (liaison anti-rejeu, v3) ─────────────────────

/**
 * Contexte authentifié par la signature v3 : il empêche de rejouer le blob
 * scellé sur un autre message. `contentHash` = sha256 hex du `messages.content`
 * stocké au moment du scellement.
 */
export interface SealedSenderContext {
  conversationId: string;
  messageId: string;
  contentHash: string;
}

/**
 * Clés publiques d'IDENTITÉ de l'expéditeur, transportées DANS le payload
 * scellé (chiffré de bout en bout au destinataire) au lieu d'être stockées en
 * clair dans `message_*_keys.sender_public_key` / `encryption_metadata.identityKey`.
 *
 * Confiance : ces champs voyagent dans un payload AES-GCM que SEUL le
 * destinataire peut ouvrir (ECDH clé éphémère ↔ clé publique du destinataire),
 * et dont l'émetteur est authentifié par la signature Ed25519 qui lie `senderId`
 * au contexte du message. En **v4**, la signature couvre AUSSI ces clés : un
 * tierce partie qui peut ré-émettre un blob (membre de la conversation) ne peut
 * donc pas les substituer. Les blobs v3 (clés non couvertes) restent lus pour
 * l'historique, mais toute NOUVELLE émission portant des clés est en v4.
 */
export interface SealedSenderIdentity {
  /** Clé publique X25519 de l'expéditeur (taguée `x25519:`). */
  x25519Key?: string | null;
  /** Clé publique d'identité ratchet (X3DH) de l'expéditeur. */
  identityKey?: string | null;
}

/** sha256 hex du contenu stocké (`messages.content`). */
export async function sealedContentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(content) as BufferSource);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// ─── Signature du payload ─────────────────────────────────────────────

function sigMessageV2(senderId: string): Uint8Array {
  return utf8(`${SIG_DOMAIN_V2}|${senderId}`);
}

function sigMessageV3(context: SealedSenderContext): Uint8Array {
  return utf8(
    `${SIG_DOMAIN_V3}|${context.conversationId}|${context.messageId}|${context.contentHash}`,
  );
}

/**
 * Message signé v4 : comme la v3 (contexte du message), PLUS les clés
 * d'identité transportées (`xk`/`ik`). Un MITM ne peut donc plus remplacer
 * l'une de ces clés en conservant une signature valide. Les champs absents sont
 * représentés par la chaîne vide ; leur position fixe + les séparateurs `|`
 * rendent le message non ambigu.
 */
function sigMessageV4(
  context: SealedSenderContext,
  x25519Key: string | null | undefined,
  identityKey: string | null | undefined,
): Uint8Array {
  return utf8(
    `${SIG_DOMAIN_V4}|${context.conversationId}|${context.messageId}|${context.contentHash}|${x25519Key ?? ''}|${identityKey ?? ''}`,
  );
}

// ─── Scellement ───────────────────────────────────────────────────────

/**
 * Scelle l'identité de l'expéditeur pour un destinataire.
 *
 * @param recipientPublicKey clé publique X25519 du destinataire (taguée ou brute)
 * @param senderId           identifiant de l'expéditeur à cacher au serveur
 * @param signingPrivateKey  clé privée Ed25519 de l'expéditeur (authentifie le scellé)
 * @param context            contexte du message → lie la signature au message
 *                           courant et empêche le rejeu. Omis → v2 (rétrocompat).
 * @param identity           clés publiques d'identité de l'expéditeur transportées
 *                           dans le payload. Leur présence déclenche la **v4**
 *                           (elles sont alors COUVERTES par la signature).
 * @returns base64 du blob scellé (opaque pour le serveur)
 */
export async function sealSenderForRecipient(
  recipientPublicKey: string,
  senderId: string,
  signingPrivateKey: string,
  context?: SealedSenderContext,
  identity?: SealedSenderIdentity,
): Promise<string> {
  const hasIdentity = !!(identity?.x25519Key || identity?.identityKey);
  let version: number;
  let message: Uint8Array;
  if (context && hasIdentity) {
    // v4 : la signature couvre le contexte ET les clés d'identité (xk/ik).
    version = PAYLOAD_VERSION_V4;
    message = sigMessageV4(context, identity?.x25519Key, identity?.identityKey);
  } else if (context) {
    // v3 : contexte seul (aucune clé d'identité à couvrir).
    version = PAYLOAD_VERSION_V3;
    message = sigMessageV3(context);
  } else {
    version = PAYLOAD_VERSION_V2;
    message = sigMessageV2(senderId);
  }
  const payloadObj: Record<string, unknown> = {
    v: version,
    s: senderId,
    sig: toBase64(ed25519.sign(message, fromBase64(signingPrivateKey))),
  };
  if (identity?.x25519Key) payloadObj.xk = identity.x25519Key;
  if (identity?.identityKey) payloadObj.ik = identity.identityKey;
  const payload = JSON.stringify(payloadObj);

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
  /**
   * Version du payload : 2 (historique), 3 (lié au contexte du message) ou
   * 4 (contexte + clés d'identité `xk`/`ik` couvertes par la signature).
   */
  version: number;
  /** Clé publique X25519 de l'expéditeur transportée dans le payload (v3+). */
  x25519Key?: string;
  /** Clé publique d'identité ratchet (X3DH) transportée dans le payload (v3+). */
  identityKey?: string;
}

/**
 * Parse un payload signé. Retourne null si legacy/non signé (identifiant en
 * clair). Un payload sans `v` est traité comme **v2** (rétrocompatibilité).
 * Les clés d'identité (`xk`/`ik`) sont optionnelles : les blobs émis avant leur
 * introduction restent valides, sans clés transportées.
 */
export function parseSealedSenderPayload(raw: string): SealedSenderPayload | null {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o.s === 'string' && typeof o.sig === 'string') {
      const v = typeof o.v === 'number' ? o.v : PAYLOAD_VERSION_V2;
      if (v === PAYLOAD_VERSION_V2 || v === PAYLOAD_VERSION_V3 || v === PAYLOAD_VERSION_V4) {
        return {
          senderId: o.s,
          signature: o.sig,
          version: v,
          x25519Key: typeof o.xk === 'string' ? o.xk : undefined,
          identityKey: typeof o.ik === 'string' ? o.ik : undefined,
        };
      }
    }
  } catch {
    // payload legacy (identifiant en clair, non signé)
  }
  return null;
}

/**
 * Vérifie la signature Ed25519 du payload avec la clé publique de l'expéditeur.
 *
 * • **v4** : `context` requis ; la signature couvre le contexte ET les clés
 *   d'identité (`xk`/`ik`) transportées → les modifier invalide la vérification.
 * • **v3** : `context` requis ; la signature couvre le contexte du message.
 * • **v2** : signature sur le seul `senderId`.
 * Dans tous les cas, sans contexte (ou avec un contexte différent) une v3/v4
 * échoue → rejeu rejeté.
 */
export function verifySealedSender(
  payload: SealedSenderPayload,
  signingPublicKey: string,
  context?: SealedSenderContext,
): boolean {
  try {
    let message: Uint8Array;
    if (payload.version >= PAYLOAD_VERSION_V4) {
      if (!context) return false;
      message = sigMessageV4(context, payload.x25519Key, payload.identityKey);
    } else if (payload.version >= PAYLOAD_VERSION_V3) {
      if (!context) return false;
      message = sigMessageV3(context);
    } else {
      message = sigMessageV2(payload.senderId);
    }
    return ed25519.verify(
      fromBase64(payload.signature),
      message,
      fromBase64(signingPublicKey),
    );
  } catch {
    return false;
  }
}

/**
 * Options de `findVerifiedSenderIdentity` / `findVerifiedSender`.
 */
export interface FindVerifiedSenderOptions {
  /**
   * Refuse les payloads **v2** (ou sans `v`) : non liés au contexte du message,
   * ils sont rejouables. À activer pour tout message non prouvé antérieur à
   * `V2_SUNSET_ISO` — c'est-à-dire via `shouldRejectUnboundV2` (fail-closed :
   * date absente/illisible ⇒ refus). Les v3/v4 restent acceptés si le contexte
   * du message vérifie.
   */
  rejectUnboundV2?: boolean;
}

/**
 * Comme `findVerifiedSender`, mais renvoie aussi les clés publiques d'identité
 * de l'expéditeur éventuellement transportées dans le payload (`xk`/`ik`).
 * C'est ce qui remplace le stockage en clair de `sender_public_key` et de
 * `identityKey` : le destinataire récupère la clé EXACTE utilisée à l'émission,
 * même après une rotation de clé de l'expéditeur.
 *
 * `options.rejectUnboundV2` refuse les blobs v2/v-absent (rejouables) — calculé
 * via `shouldRejectUnboundV2(created_at)` (fail-closed si la date est inconnue).
 */
export async function findVerifiedSenderIdentity(
  myPrivateKeyB64: string,
  blobs: string[],
  getSigningKey: (senderId: string) => Promise<string | null>,
  context?: SealedSenderContext,
  options?: FindVerifiedSenderOptions,
): Promise<{ senderId: string; x25519Key?: string; identityKey?: string } | null> {
  for (const blob of blobs) {
    let raw: string;
    try {
      raw = await openSealedSender(myPrivateKeyB64, blob);
    } catch {
      continue; // pas le bon blob
    }
    const payload = parseSealedSenderPayload(raw);
    if (!payload) continue; // non authentifié → ignoré
    // Bascule v2 : passé `V2_SUNSET_ISO`, un blob non lié au message (v2/sans v)
    // est rejeté → l'expéditeur n'est pas attribué (anti-rejeu).
    if (options?.rejectUnboundV2 && payload.version < PAYLOAD_VERSION_V3) continue;
    const signingKey = await getSigningKey(payload.senderId);
    if (!signingKey) continue;
    if (verifySealedSender(payload, signingKey, context)) {
      return { senderId: payload.senderId, x25519Key: payload.x25519Key, identityKey: payload.identityKey };
    }
  }
  return null;
}

/**
 * Retrouve l'expéditeur **authentifié** parmi des blobs scellés.
 * Pour chaque blob ouvrable, on parse le payload signé puis on **vérifie** la
 * signature avec la clé publique de l'expéditeur revendiqué (`getSigningKey`).
 * Un payload non signé (legacy) est ignoré → retour `null` (repli sender_id).
 * → Empêche l'usurpation : sceller l'id d'un autre échoue à la vérification.
 *
 * `context` (v3) lie la vérification au message courant : un blob v3 rejoué sur
 * un autre message (id / conversation / contenu différents) est **rejeté**.
 *
 * `options.rejectUnboundV2` refuse les blobs v2/v-absent (rejouables) pour les
 * messages postérieurs à `V2_SUNSET_ISO`.
 */
export async function findVerifiedSender(
  myPrivateKeyB64: string,
  blobs: string[],
  getSigningKey: (senderId: string) => Promise<string | null>,
  context?: SealedSenderContext,
  options?: FindVerifiedSenderOptions,
): Promise<string | null> {
  const found = await findVerifiedSenderIdentity(myPrivateKeyB64, blobs, getSigningKey, context, options);
  return found?.senderId ?? null;
}

/** Scelle l'identité pour tous les membres (un blob chacun). */
export async function sealSenderForMembers(
  memberPublicKeys: string[],
  senderId: string,
  signingPrivateKey: string,
  context?: SealedSenderContext,
  identity?: SealedSenderIdentity,
): Promise<string[]> {
  return Promise.all(
    memberPublicKeys.map(pk => sealSenderForRecipient(pk, senderId, signingPrivateKey, context, identity)),
  );
}
