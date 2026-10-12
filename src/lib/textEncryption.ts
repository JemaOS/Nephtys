// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Chiffrement E2EE du texte des messages.
 *
 * Objectif : le serveur (Supabase) ne doit jamais stocker le contenu en
 * clair d'un message texte — il ne doit voir qu'un blob opaque.
 *
 * Architecture (identique au modèle média déjà en production, cf.
 * `encryptedMediaService.ts`, mais réutilise la même infrastructure de
 * clés ECDH par utilisateur, `profiles.public_key`) :
 *
 *   Envoi
 *     1. on rembourre (pad) le texte puis on le chiffre avec une clé
 *        AES-256 unique au message (AES-GCM) ;
 *     2. on enveloppe cette clé AES pour CHAQUE membre de la conversation
 *        avec la clé partagée sender↔membre (dérivée par ECDH) ;
 *     3. `messages.content` reçoit le ciphertext (base64) +
 *        `messages.encryption_metadata = { v, iv }` ;
 *     4. les clés enveloppées sont stockées dans `message_text_keys`.
 *
 *   Réception
 *     1. on lit la clé enveloppée destinée à l'utilisateur ;
 *     2. on dérive la clé partagée sender↔soi, on déchiffre la clé AES ;
 *     3. on télécharge/déchiffre le ciphertext et on dérembourre.
 *
 * Le rembourrage (padding) masque la longueur réelle des messages, qui
 * est sinon une métadonnée exploitable (analyse de taille).
 *
 * Compatibilité : les messages sans `is_text_encrypted` (ou dont le
 * déchiffrement échoue) sont retournés tels quels — aucune régression.
 */

import { supabase } from './supabase';
import { encryptMedia, decryptMedia, cryptoB64 } from './mediaEncryption';
import { fetchX25519PublicKeys, getLocalX25519KeyPair } from './e2eeX25519';
import { wrapKeyForRecipientX25519, unwrapKeyFromSenderX25519, keyWrapAad } from './x25519';
import { isRatchetEnvelope, tryDecryptWithRatchet } from './ratchet/chatIntegration';
import { getLocalRatchetKeys } from './ratchet/keyStore';
import { findVerifiedSenderIdentity, sealSenderForMembers, sealedContentHash, isAfterV2Sunset, type SealedSenderContext, type SealedSenderIdentity } from './messaging/sealedSender';

// Paliers (buckets) de rembourrage. Un message est rembourré à la BORNE
// SUPÉRIEURE de paliers fixes : tous les messages qui tombent dans le même
// palier partagent la MÊME taille de ciphertext. Ex. avec les paliers par
// défaut, 600 o et 900 o tombent tous deux dans 1024 → indistinguables, alors
// que l'ancien rembourrage au multiple de 256 les séparait (768 vs 1024) : le
// pas s'élargit avec la taille au lieu de rester à 256 partout.
//
// Au-delà du dernier palier, on arrondit au multiple de ce dernier.
// Configurable via la constante exportée ou la variable d'env
// `VITE_TEXT_PAD_BUCKETS` (liste d'octets séparés par des virgules).
const LENGTH_PREFIX_BYTES = 4;
const ENVELOPE_VERSION = 1;

export const DEFAULT_TEXT_PAD_BUCKETS: readonly number[] = [
  256, 512, 1024, 2048, 4096, 8192, 16384, 32768,
];

/** Normalise une liste de paliers : entier > 0, dédupliqué, trié croissant. */
function normalizeBuckets(values: number[]): number[] | null {
  const cleaned = values
    .filter(v => Number.isFinite(v) && v > 0)
    .map(v => Math.floor(v));
  if (cleaned.length === 0) return null;
  return [...new Set(cleaned)].sort((a, b) => a - b);
}

/** Lit une liste de paliers depuis une chaîne « 256,512,... » (env). */
function parseBuckets(raw: unknown): number[] | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parsed = raw.split(',').map(part => Number(part.trim()));
  return normalizeBuckets(parsed);
}

/**
 * Paliers de rembourrage effectifs (env prioritaire, sinon défaut).
 * Exporté pour les tests et l'introspection.
 */
export const TEXT_PAD_BUCKETS: readonly number[] = (() => {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const fromEnv = parseBuckets(env?.VITE_TEXT_PAD_BUCKETS);
  return fromEnv ?? DEFAULT_TEXT_PAD_BUCKETS;
})();

/**
 * Taille totale rembourrée pour une longueur donnée : plus petit palier ≥
 * longueur, ou multiple du plus grand palier au-delà.
 */
function paddedLength(contentLength: number): number {
  for (const bucket of TEXT_PAD_BUCKETS) {
    if (contentLength <= bucket) return bucket;
  }
  const largest = TEXT_PAD_BUCKETS[TEXT_PAD_BUCKETS.length - 1];
  return Math.ceil(contentLength / largest) * largest;
}

// ─── Rembourrage ──────────────────────────────────────────────────────

/**
 * Sérialise une chaîne UTF-8 avec un préfixe de longueur (4 octets, BE)
 * puis complète avec des octets aléatoires jusqu'à la borne supérieure du
 * palier englobant. Le FORMAT (longueur + contenu + aléatoire) est inchangé :
 * `unpad` reste capable de lire les anciens messages rembourrés en multiples
 * de 256, la longueur réelle étant portée par le préfixe.
 */
function pad(plaintext: string): Uint8Array {
  const bytes = new TextEncoder().encode(plaintext);
  const withLength = new Uint8Array(LENGTH_PREFIX_BYTES + bytes.length);
  new DataView(withLength.buffer).setUint32(0, bytes.length, false);
  withLength.set(bytes, LENGTH_PREFIX_BYTES);

  const total = paddedLength(withLength.length);
  const out = new Uint8Array(total);
  out.set(withLength, 0);
  if (total > withLength.length) {
    out.set(crypto.getRandomValues(new Uint8Array(total - withLength.length)), withLength.length);
  }
  return out;
}

/**
 * Inverse de `pad` : lit la longueur puis restitue le texte d'origine.
 * @throws si le buffer est trop court (données corrompues)
 */
function unpad(padded: Uint8Array): string {
  if (padded.length < LENGTH_PREFIX_BYTES) {
    throw new Error('textEncryption: buffer trop court');
  }
  const length = new DataView(padded.buffer, padded.byteOffset, LENGTH_PREFIX_BYTES)
    .getUint32(0, false);
  if (LENGTH_PREFIX_BYTES + length > padded.length) {
    throw new Error('textEncryption: longueur invalide');
  }
  return new TextDecoder().decode(padded.slice(LENGTH_PREFIX_BYTES, LENGTH_PREFIX_BYTES + length));
}

// ─── Enveloppe stockée dans messages.encryption_metadata ──────────────

/**
 * Payload interne chiffré : un JSON estampillé `__npt` pour distinguer de
 * façon robuste notre format d'un texte brut (rétrocompatibilité).
 * Le `link_preview` est rangé ICI plutôt que dans une colonne DB : ainsi le
 * serveur ne voit ni le texte ni les métadonnées de lien.
 */
const PAYLOAD_MARKER = '__npt';

export function serializeTextPayload(text: string, linkPreview: unknown | null | undefined): string {
  const payload: Record<string, unknown> = { [PAYLOAD_MARKER]: 1, t: text };
  if (linkPreview) payload.lp = linkPreview;
  return JSON.stringify(payload);
}

export function parseTextPayload(raw: string): { text: string; linkPreview: unknown | null } {
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && (obj as any)[PAYLOAD_MARKER] === 1 && typeof (obj as any).t === 'string') {
      return { text: (obj as any).t, linkPreview: (obj as any).lp ?? null };
    }
  } catch {
    // texte brut (ancien format) → traité tel quel
  }
  return { text: raw, linkPreview: null };
}

export interface TextEnvelope {
  v: number;
  /** IV du chiffrement AES-GCM du texte (base64) */
  iv: string;
}

export interface EncryptedTextPayload {
  /** Ciphertext base64 — ce qui va dans messages.content */
  ciphertextB64: string;
  /** IV base64 — ce qui va dans messages.encryption_metadata.iv */
  ivB64: string;
  /** Clé AES brute (32 octets) à envelopper pour chaque destinataire */
  rawKey: Uint8Array;
}

/**
 * Chiffre un texte (et éventuellement son aperçu de lien) : renvoie le
 * ciphertext + l'IV + la clé AES brute.
 * Ne touche pas au réseau — l'appelant persiste via `createTextKeysForMessage`.
 */
export async function encryptText(
  plaintext: string,
  linkPreview?: unknown | null,
): Promise<EncryptedTextPayload> {
  const padded = pad(serializeTextPayload(plaintext, linkPreview));
  const { ciphertext, rawKey, iv } = await encryptMedia(padded.buffer as ArrayBuffer);
  return {
    ciphertextB64: cryptoB64.toBase64(ciphertext),
    ivB64: cryptoB64.toBase64(iv),
    rawKey,
  };
}

/**
 * Déchiffre un texte à partir du ciphertext, de l'IV et de la clé AES brute.
 */
export async function decryptText(
  ciphertextB64: string,
  ivB64: string,
  rawKey: Uint8Array,
): Promise<string> {
  return (await decryptTextPayload(ciphertextB64, ivB64, rawKey)).text;
}

/**
 * Déchiffre le payload complet : renvoie le texte ET l'aperçu de lien
 * éventuel (le tout chiffré côté serveur).
 */
export async function decryptTextPayload(
  ciphertextB64: string,
  ivB64: string,
  rawKey: Uint8Array,
): Promise<{ text: string; linkPreview: unknown | null }> {
  const ciphertext = new Uint8Array(cryptoB64.fromBase64(ciphertextB64));
  const iv = new Uint8Array(cryptoB64.fromBase64(ivB64));
  const plain = await decryptMedia(ciphertext, rawKey, iv);
  return parseTextPayload(unpad(plain));
}

// ─── Clés enveloppées (message_text_keys) ─────────────────────────────

/**
 * Persiste les clés AES enveloppées pour tous les membres d'une
 * conversation. L'expéditeur est inclus pour qu'il puisse relire ses
 * propres messages depuis la DB / un autre device.
 */
export async function createTextKeysForMessage(params: {
  messageId: string;
  senderId: string;
  conversationId: string;
  rawKey: Uint8Array;
}): Promise<{ inserted: number; missingKeys: string[] }> {
  const { messageId, senderId, conversationId, rawKey } = params;

  const { data: members } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  const recipientIds = members?.map(m => m.user_id) ?? [];
  if (recipientIds.length === 0) {
    return { inserted: 0, missingKeys: [] };
  }

  // Chiffrement X25519 uniquement (pile P-256 retirée).
  const senderX25519 = await getLocalX25519KeyPair(senderId);
  if (!senderX25519) {
    // Fail-closed : sans la paire locale on ne peut envelopper la clé pour
    // personne (pas même pour soi) → on refuse plutôt que de laisser un
    // message indéchiffrable (et on n'a AUCUN repli en clair).
    throw new Error('Clés E2EE locales absentes (X25519) : envoi annulé');
  }
  const x25519Publics = await fetchX25519PublicKeys(recipientIds);

  const missingKeys: string[] = [];
  const rows: any[] = [];

  for (const recipientId of recipientIds) {
    const recipientX25519 = x25519Publics.get(recipientId);
    try {
      if (!recipientX25519) {
        missingKeys.push(recipientId);
        continue;
      }
      const wrapped = await wrapKeyForRecipientX25519(
        rawKey,
        senderX25519.privateKey,
        senderX25519.publicKey,
        recipientX25519,
        keyWrapAad(senderX25519.publicKey),
      );
      rows.push({
        message_id: messageId,
        recipient_id: recipientId,
        encrypted_key: wrapped.encryptedKey,
        iv: wrapped.iv,
        // ⚠️ Sealed sender : on N'ÉCRIT PLUS la clé publique STABLE de
        // l'expéditeur (elle permettait au serveur de retrouver qui écrit, en
        // joignant profiles.x25519_public_key). Elle est désormais transportée
        // dans le payload sealed sender v3 (cf. buildSenderSealed) ou dérivée
        // côté destinataire. La colonne reste (nullable) pour l'ancien trafic.
      });
    } catch (e) {
      console.error('[textEncryption] wrap failed for', recipientId, e);
      missingKeys.push(recipientId);
    }
  }

  if (rows.length === 0) {
    // Fail-closed : aucune clé enveloppée (échec de wrapping ou clés
    // publiques absentes). On remonte l'erreur au lieu de laisser passer un
    // message que PERSONNE ne pourra déchiffrer.
    throw new Error('Échec du chiffrement : aucune clé de message n\'a pu être créée');
  }

  const { error } = await supabase.from('message_text_keys').insert(rows);
  if (error) {
    console.error('[textEncryption] insert message_text_keys failed:', error);
    throw new Error('Échec de la sauvegarde des clés de chiffrement du message');
  }

  return { inserted: rows.length, missingKeys };
}

// ─── Lecture / déchiffrement haut niveau ──────────────────────────────

/** Extrait l'enveloppe depuis `messages.encryption_metadata` (JSONB). */
export function parseEnvelope(metadata: unknown): TextEnvelope | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  if (typeof m.iv !== 'string') return null;
  return { v: typeof m.v === 'number' ? m.v : ENVELOPE_VERSION, iv: m.iv };
}

/** Affiché si un message est chiffré mais indéchiffrable sur cet appareil
 *  (clé absente, autre appareil, etc.) — évite d'afficher du base64 brut. */
export const UNDECRYPTABLE_PLACEHOLDER = '🔒 Message chiffré — indéchiffrable sur cet appareil';

/** Cache (id → clair) du texte DÉJÀ déchiffré. Indispensable :
 *  plusieurs chemins (chargement, pagination, temps réel) se disputent l'état et
 *  ré-écrivent parfois la version ciphertext ; ce cache garantit qu'un message
 *  DÉJÀ déchiffré reste affiché en clair. Persisté en localStorage pour survivre
 *  au rechargement (et pour que l'EXPÉDITEUR voie aussi SES PROPRES messages).
 */
const PLAINTEXT_CACHE_KEY = 'nephtys_plaintext_cache_v1';
const PLAINTEXT_CACHE_MAX = 500;
const decryptedTextCache = new Map<string, string>();

// Le clair n'est PLUS persisté (ni localStorage ni IndexedDB) : il ne vit
// qu'en mémoire de session et disparaît au rechargement / à la déconnexion.
// On purge toute trace laissée par les anciennes versions.
try {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(PLAINTEXT_CACHE_KEY);
} catch {
  // ignore
}

function persistPlaintextCache(): void {
  // Borne uniquement le cache MÉMOIRE (aucune écriture disque).
  while (decryptedTextCache.size > PLAINTEXT_CACHE_MAX) {
    const first = decryptedTextCache.keys().next().value as string | undefined;
    if (first === undefined) break;
    decryptedTextCache.delete(first);
  }
}

export function getCachedDecryptedText(id: string): string | undefined {
  return decryptedTextCache.get(id);
}

/** Mémorise le clair d'un message (déchiffré OU envoyé par soi) par id. */
export function cacheDecryptedText(id: string, text: string): void {
  decryptedTextCache.set(id, text);
  persistPlaintextCache();
}

/** Cache paresseux de la paire X25519 pour un batch. */
interface UnwrapCaches {
  x25519?: Awaited<ReturnType<typeof getLocalX25519KeyPair>> | null;
}

// ─── Re-tentative (ordre message → clés) ──────────────────────────────
//
// Quand un message chiffré arrive AVANT ses clés enveloppées (message_text_keys),
// le déchiffrement échoue et on affiche le placeholder 🔒. On NE perd plus le
// ciphertext pour autant : on le conserve ici, indexé par id, pour pouvoir
// RE-TENTER le déchiffrement dès que la clé arrive, sans jamais réécrire le
// ciphertext de façon durable par le placeholder.

interface PendingDecryption {
  id: string;
  content: string;
  is_text_encrypted: boolean;
  encryption_metadata: unknown;
  sender_id?: string;
  sender_sealed?: unknown;
  conversation_id?: string;
}

const pendingDecryptions = new Map<string, PendingDecryption>();

function rememberPendingDecryption(row: {
  id?: unknown;
  content?: unknown;
  is_text_encrypted?: unknown;
  encryption_metadata?: unknown;
  sender_id?: unknown;
  sender_sealed?: unknown;
  conversation_id?: unknown;
}): void {
  if (!row || typeof row.id !== 'string' || typeof row.content !== 'string') return;
  pendingDecryptions.set(row.id, {
    id: row.id,
    content: row.content,
    is_text_encrypted: !!row.is_text_encrypted,
    encryption_metadata: row.encryption_metadata,
    sender_id: typeof row.sender_id === 'string' ? row.sender_id : undefined,
    sender_sealed: row.sender_sealed,
    conversation_id: typeof row.conversation_id === 'string' ? row.conversation_id : undefined,
  });
}

/**
 * Affiche le placeholder SANS perdre le ciphertext : on mémorise d'abord la
 * version chiffrée (jamais écrasée par un placeholder déjà posé).
 */
function markUndecryptable(row: any): void {
  if (row.content !== UNDECRYPTABLE_PLACEHOLDER) rememberPendingDecryption(row);
  row.content = UNDECRYPTABLE_PLACEHOLDER;
}

/** Identifiants des messages en attente de (re)déchiffrement. */
export function getPendingDecryptionIds(): string[] {
  return [...pendingDecryptions.keys()];
}

/** Purge l'état « en attente » d'un message (ex. après suppression). */
export function clearPendingDecryption(id: string): void {
  pendingDecryptions.delete(id);
}

/**
 * Re-tente le déchiffrement d'un message précédemment marqué indéchiffrable, à
 * partir du ciphertext conservé. À appeler quand les clés du message arrivent.
 * Retourne le texte déchiffré, ou `null` si toujours indéchiffrable (le message
 * reste en attente, jamais remplacé durablement par le placeholder).
 */
export async function retryPendingDecryption(id: string, userId: string): Promise<string | null> {
  const pending = pendingDecryptions.get(id);
  if (!pending) return null;
  const row = {
    id: pending.id,
    content: pending.content,
    is_text_encrypted: pending.is_text_encrypted,
    encryption_metadata: pending.encryption_metadata,
    sender_id: pending.sender_id,
    sender_sealed: pending.sender_sealed,
    conversation_id: pending.conversation_id,
  };
  const [decrypted] = await decryptMessageRows([row], userId);
  if (decrypted && decrypted.content !== UNDECRYPTABLE_PLACEHOLDER) {
    decryptedTextCache.set(id, decrypted.content);
    pendingDecryptions.delete(id);
    return decrypted.content;
  }
  return null;
}

/** Re-tente tous les messages en attente ; retourne ceux qui ont été déchiffrés. */
export async function retryAllPendingDecryptions(
  userId: string,
): Promise<Array<{ id: string; text: string }>> {
  const out: Array<{ id: string; text: string }> = [];
  for (const id of [...pendingDecryptions.keys()]) {
    const text = await retryPendingDecryption(id, userId);
    if (text !== null) out.push({ id, text });
  }
  return out;
}

/** Repli : clé publique X25519 publiée de l'expéditeur (`profiles`). */
async function deriveSenderX25519Key(
  senderId: string,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  const hit = cache?.get(senderId);
  if (hit !== undefined) return hit;
  let key: string | null = null;
  try {
    const { data } = await supabase
      .from('profiles')
      .select('x25519_public_key')
      .eq('id', senderId)
      .maybeSingle();
    const value = data?.x25519_public_key;
    key = typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    key = null;
  }
  cache?.set(senderId, key);
  return key;
}

/**
 * Clé publique X25519 de l'expéditeur, par ordre de priorité :
 *   1. colonne `message_text_keys.sender_public_key` (ancien trafic) ;
 *   2. clé transportée par le payload sealed sender v3 (`sender_x25519_key`,
 *      résolue dans `resolveSealedSenders`) — robuste aux rotations de clé ;
 *   3. dérivation depuis `profiles.x25519_public_key(senderId)` après
 *      vérification du scellé (`sender_id` authentifié).
 * Retourne `null` si introuvable → le message restera indéchiffrable (cadenas).
 */
async function resolveSenderPublicKey(
  stored: string | null | undefined,
  transported: string | null | undefined,
  senderId: string | null | undefined,
  cache?: Map<string, string | null>,
): Promise<string | null> {
  if (stored) return stored;
  if (transported) return transported;
  if (senderId) return await deriveSenderX25519Key(senderId, cache);
  return null;
}

/** Déchiffre une clé AES enveloppée (X25519) avec la clé publique d'expéditeur résolue. */
async function unwrapKeyRowForUser(
  keyRow: { encrypted_key: string; iv: string; sender_public_key: string | null },
  senderPublicKey: string,
  userId: string,
  caches: UnwrapCaches,
): Promise<Uint8Array> {
  const wrapped = {
    encryptedKey: keyRow.encrypted_key,
    iv: keyRow.iv,
    senderPublicKey,
  };
  if (caches.x25519 === undefined) caches.x25519 = await getLocalX25519KeyPair(userId);
  if (!caches.x25519) throw new Error('Clé X25519 locale indisponible');
  return await unwrapKeyFromSenderX25519(wrapped, caches.x25519.privateKey, keyWrapAad(senderPublicKey));
}

// ─── Repli robuste : clé d'expéditeur via un MEMBRE de la conversation ─
//
// Quand `message_text_keys.sender_public_key` (colonne) ET le payload sealed
// sender v3 (`xk`) sont absents — et que `sender_id` n'est pas exploitable —
// le destinataire ne peut plus « dériver » la clé de l'expéditeur. On essaie
// alors la clé publique X25519 de CHAQUE membre de la conversation : l'enveloppe
// est liée par AAD à la clé de l'expéditeur (`keyWrapAad`), donc une SEULE
// candidate peut déchiffrer — celle de l'expéditeur, qui l'identifie par
// conséquent (attribution + déchiffrement). En 1:1 → 1 candidate utile : coût
// négligeable.

/** Clés publiques X25519 (authentifiées) des membres d'une conversation. */
async function fetchConversationMemberKeys(
  conversationId: string,
  cache?: Map<string, Promise<Map<string, string>>>,
): Promise<Map<string, string>> {
  const hit = cache?.get(conversationId);
  if (hit) return hit;
  const promise = (async () => {
    try {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId);
      const ids = (members ?? [])
        .map((m: { user_id: string }) => m.user_id)
        .filter(Boolean);
      if (ids.length === 0) return new Map<string, string>();
      return await fetchX25519PublicKeys(ids);
    } catch {
      return new Map<string, string>();
    }
  })();
  cache?.set(conversationId, promise);
  return promise;
}

/**
 * Repli « clé absente » : tente de déchiffrer l'enveloppe avec la clé publique
 * de chacun des membres de la conversation. Retourne la clé AES brute ET
 * l'identité (membre) dont la clé a réussi — c'est l'expéditeur.
 * Exporté pour le média (`encryptedMediaService`).
 */
export async function tryUnwrapWithMemberKeys(
  keyRow: { encrypted_key: string; iv: string },
  conversationId: string | undefined,
  userId: string,
  opts?: {
    myPrivateKey?: string;
    conversationKeyCache?: Map<string, Promise<Map<string, string>>>;
  },
): Promise<{ rawKey: Uint8Array; senderId: string; senderPublicKey: string } | null> {
  if (!conversationId) return null;
  const memberKeys = await fetchConversationMemberKeys(conversationId, opts?.conversationKeyCache);
  if (memberKeys.size === 0) return null;

  let myPrivateKey = opts?.myPrivateKey;
  if (!myPrivateKey) {
    const kp = await getLocalX25519KeyPair(userId);
    if (!kp) return null;
    myPrivateKey = kp.privateKey;
  }

  for (const [memberId, publicKey] of memberKeys) {
    try {
      const rawKey = await unwrapKeyFromSenderX25519(
        { encryptedKey: keyRow.encrypted_key, iv: keyRow.iv, senderPublicKey: publicKey },
        myPrivateKey,
        keyWrapAad(publicKey),
      );
      return { rawKey, senderId: memberId, senderPublicKey: publicKey };
    } catch {
      // Cette candidate n'est pas la clé de l'expéditeur → candidate suivante.
    }
  }
  return null;
}

/**
 * Résout la clé AES brute d'une ligne `message_text_keys`, dans l'ordre :
 *   1. `sender_public_key` (colonne, ancien trafic) ;
 *   2. payload sealed sender v3 (`sender_x25519_key`) → robuste aux rotations ;
 *   3. `profiles.x25519_public_key(sender_id)` (sender authentifié) ;
 *   4. REPLI : clé publique d'un membre de la conversation (identifie
 *      l'expéditeur) — cf. `tryUnwrapWithMemberKeys`.
 * `senderId` n'est renseigné que lorsque la clé provient du repli « membres »,
 * pour attribution.
 */
async function resolveRowRawKey(params: {
  keyRow: { encrypted_key: string; iv: string; sender_public_key: string | null };
  senderX25519Key?: string | null;
  senderId?: string | null;
  conversationId?: string;
  userId: string;
  caches: UnwrapCaches;
  senderKeyCache?: Map<string, string | null>;
  memberKeysCache?: Map<string, Promise<Map<string, string>>>;
}): Promise<{ rawKey: Uint8Array; senderId?: string; senderPublicKey: string } | null> {
  const { keyRow, userId, caches } = params;
  const senderPublicKey = await resolveSenderPublicKey(
    keyRow.sender_public_key,
    params.senderX25519Key,
    params.senderId,
    params.senderKeyCache,
  );
  if (senderPublicKey) {
    try {
      const rawKey = await unwrapKeyRowForUser(keyRow, senderPublicKey, userId, caches);
      return { rawKey, senderPublicKey };
    } catch {
      // Clé résolue mais indéchiffrable (rotation ?) → repli « membres ».
    }
  }
  const candidate = await tryUnwrapWithMemberKeys(keyRow, params.conversationId, userId, {
    myPrivateKey: caches.x25519?.privateKey,
    conversationKeyCache: params.memberKeysCache,
  });
  if (!candidate) return null;
  return {
    rawKey: candidate.rawKey,
    senderId: candidate.senderId,
    senderPublicKey: candidate.senderPublicKey,
  };
}

/**
 * Déchiffre le contenu d'un message pour un utilisateur donné.
 * Retourne le texte en clair, ou `null` si le message n'est pas chiffré
 * ou si le déchiffrement est impossible (clé absente, pas de passphrase…).
 */
export async function decryptMessageContent(
  message: { id: string; content: string; is_text_encrypted?: boolean | null; encryption_metadata?: unknown; sender_id?: string; sender_sealed?: unknown; conversation_id?: string; created_at?: string; sender_x25519_key?: string | null; sender_identity_key?: string | null },
  userId: string,
): Promise<string | null> {
  await resolveSealedSenders([message], userId);
  if (!message.is_text_encrypted) return message.content;

  // Chemin forward-secret (Double Ratchet) prioritaire, puis repli X25519.
  const meta = message.encryption_metadata as any;
  const ratchetEnv = meta?.ratchet ?? (isRatchetEnvelope(meta) ? meta : null);
  if (ratchetEnv) {
    const isMine = message.sender_id && message.sender_id === userId;
    if (!isMine) {
      const ratchetContent = meta?.ratchetContent ?? message.content;
      const raw = await tryDecryptWithRatchet(
        ratchetEnv,
        ratchetContent,
        userId,
        // Session indexée par CONVERSATION (insensible au sealed sender).
        message.conversation_id ?? message.sender_id ?? '',
        // Expéditeur authentifié : permet de retrouver sa clé d'identité ratchet
        // (payload v3 transporté, sinon profiles.ratchet_identity_key).
        message.sender_id,
        message.sender_identity_key,
      );
      if (raw !== null) {
        clearPendingDecryption(message.id);
        return parseTextPayload(raw).text;
      }
    }
    // échec ratchet (ou message à soi) → repli X25519 ci-dessous.
  }

  const envelope = parseEnvelope(message.encryption_metadata);
  if (!envelope) {
    markUndecryptable(message);
    return UNDECRYPTABLE_PLACEHOLDER;
  }

  let keyRow: { encrypted_key: string; iv: string; sender_public_key: string | null } | null = null;
  try {
    const { data, error } = await supabase
      .from('message_text_keys')
      .select('encrypted_key, iv, sender_public_key')
      .eq('message_id', message.id)
      .eq('recipient_id', userId)
      .maybeSingle();
    if (error) {
      markUndecryptable(message);
      return UNDECRYPTABLE_PLACEHOLDER;
    }
    keyRow = data;
  } catch (e) {
    console.warn('[textEncryption] key fetch failed for message', message.id, e);
    markUndecryptable(message);
    return UNDECRYPTABLE_PLACEHOLDER;
  }

  if (!keyRow) {
    markUndecryptable(message);
    return UNDECRYPTABLE_PLACEHOLDER;
  }

  try {
    const resolved = await resolveRowRawKey({
      keyRow,
      senderX25519Key: message.sender_x25519_key,
      senderId: message.sender_id,
      conversationId: message.conversation_id,
      userId,
      caches: {},
    });
    if (!resolved) throw new Error('clé publique expéditeur introuvable');
    // Repli « membres » → la candidate qui a déchiffré EST l'expéditeur.
    if (resolved.senderId && !message.sender_id) message.sender_id = resolved.senderId;
    const text = await decryptText(message.content, envelope.iv, resolved.rawKey);
    clearPendingDecryption(message.id);
    return text;
  } catch (e) {
    console.warn('[textEncryption] decrypt failed for message', message.id, e);
    markUndecryptable(message);
    return UNDECRYPTABLE_PLACEHOLDER;
  }
}

/**
 * Déchiffre en place une liste de messages (mutate `content`).
 * Les messages non chiffrés ou non déchiffrables restent inchangés.
 * Retourne la même liste pour faciliter le chaînage.
 *
 * Optimisé : une seule requête `message_text_keys` (batch) + une seule
 * lecture de la paire de clés, quel que soit le nombre de messages.
 */
export async function decryptMessageRows<T extends {
  id: string;
  content: string;
  is_text_encrypted?: boolean | null;
  encryption_metadata?: unknown;
}>(rows: T[] | null | undefined, userId: string): Promise<T[]> {
  if (!rows || rows.length === 0) return rows ?? [];

  // Phase 1 (sealed sender) : résout l'expéditeur réel depuis les blobs scellés
  // AVANT tout usage de sender_id. Repli sur sender_id si absent/illisible.
  // On transmet id/conversation_id/content pour permettre la vérification v3
  // (signature liée au contexte du message → blob non rejouable).
  await resolveSealedSenders(
    rows as Array<{
      id?: string;
      sender_id?: string | null;
      conversation_id?: string;
      created_at?: string;
      content?: string;
      sender_sealed?: unknown;
      sender_x25519_key?: string | null;
      sender_identity_key?: string | null;
    }>,
    userId,
  );

  // Tout message marqué chiffré est traité : s'il n'est pas déchiffrable (clé
  // absente, enveloppe illisible), il reçoit le PLACEHOLDER — jamais le
  // ciphertext brut (régression détectée en test 2-appareils avec serveur aveugle).
  const encrypted = rows.filter(r => r.is_text_encrypted);
  if (encrypted.length === 0) return rows;
  // Double chiffrement : des clés X25519 (repli garanti) existent AUSSI pour les
  // messages ratchet → on récupère les clés pour TOUS les messages chiffrés.
  const wrappedIds = encrypted.map(r => r.id);

  const keyByMessage = new Map<string, any>();
  if (wrappedIds.length > 0) {
    try {
      const { data: keyRows } = await supabase
        .from('message_text_keys')
        .select('message_id, encrypted_key, iv, sender_public_key')
        .eq('recipient_id', userId)
        .in('message_id', wrappedIds);
      keyRows?.forEach(k => keyByMessage.set(k.message_id as string, k));
    } catch (e) {
      // Une erreur réseau/DB ne doit JAMAIS faire échouer le déchiffrement
      // en bloc : on continue, les messages concernés afficheront le cadenas.
      console.warn('[textEncryption] fetch keys failed:', e);
    }
  }

  const caches: UnwrapCaches = {};
  // Cache par lot : évite une requête `profiles` par message quand la clé
  // publique de l'expéditeur doit être dérivée (nouveau trafic sans colonne).
  const senderKeyCache = new Map<string, string | null>();
  // Cache par lot des clés publiques des membres (repli « clé absente »).
  const memberKeysCache = new Map<string, Promise<Map<string, string>>>();

  await Promise.all(
    encrypted.map(async row => {
      const meta = row.encryption_metadata as any;
      // Enveloppe ratchet : soit imbriquée (double chiffrement), soit directe.
      const ratchetEnv = meta?.ratchet ?? (isRatchetEnvelope(meta) ? meta : null);
      const ratchetContent = meta?.ratchetContent ?? row.content;

      // 1) Forward secrecy (Double Ratchet) — messages REÇUS.
      if (ratchetEnv) {
        if ((row as any).sender_id && (row as any).sender_id === userId) {
          const mine = decryptedTextCache.get(row.id);
          if (mine !== undefined) { row.content = mine; (row as any).is_text_encrypted = false; clearPendingDecryption(row.id); return; }
          // ses propres messages : pas de re-déchiffrement ratchet → on tente X25519 ci-dessous
        } else {
          const raw = await tryDecryptWithRatchet(
            ratchetEnv,
            ratchetContent,
            userId,
            (row as any).conversation_id ?? (row as any).sender_id ?? '',
            (row as any).sender_id,
            (row as any).sender_identity_key,
          );
          if (raw !== null) {
            const payload = parseTextPayload(raw);
            row.content = payload.text;
            (row as any).is_text_encrypted = false;
            cacheDecryptedText(row.id, payload.text);
            clearPendingDecryption(row.id);
            if (payload.linkPreview) (row as any).link_preview = JSON.stringify(payload.linkPreview);
            return;
          }
          // échec ratchet → on tente le repli X25519 (ci-dessous).
        }
      }

      // 2) Repli X25519 (TOUJOURS présent en double chiffrement) — garantit
      // que TOUT destinataire peut déchiffrer, même sans clés ratchet.
      const envelope = parseEnvelope(row.encryption_metadata);
      const keyRow = keyByMessage.get(row.id);
      if (!envelope || !keyRow) {
        markUndecryptable(row);
        return;
      }
      try {
        const resolved = await resolveRowRawKey({
          keyRow,
          senderX25519Key: (row as any).sender_x25519_key,
          senderId: (row as any).sender_id,
          conversationId: (row as any).conversation_id,
          userId,
          caches,
          senderKeyCache,
          memberKeysCache,
        });
        if (!resolved) throw new Error('clé publique expéditeur introuvable');
        // Repli « membres » → la candidate qui a déchiffré EST l'expéditeur.
        if (resolved.senderId && !(row as any).sender_id) {
          (row as any).sender_id = resolved.senderId;
          (row as any).sender_x25519_key = resolved.senderPublicKey;
        }
        const payload = await decryptTextPayload(row.content, envelope.iv, resolved.rawKey);
        row.content = payload.text;
        (row as any).is_text_encrypted = false;
        cacheDecryptedText(row.id, payload.text);
        clearPendingDecryption(row.id);
        if (payload.linkPreview) {
          (row as any).link_preview = JSON.stringify(payload.linkPreview);
        }
      } catch (e) {
        console.warn('[textEncryption] batch decrypt failed for message', row.id, e);
        markUndecryptable(row);
      }
    }),
  );

  return rows;
}

/**
 * Déchiffre un message unique en place (content + link_preview).
 * Retourne le message (muté). Utilisé pour les messages temps réel.
 */
export async function decryptMessageRow<T extends {
  id: string;
  content: string;
  is_text_encrypted?: boolean | null;
  encryption_metadata?: unknown;
}>(row: T, userId: string): Promise<T> {
  if (!row.is_text_encrypted) return row;
  const [decrypted] = await decryptMessageRows([row], userId);
  return decrypted ?? row;
}

// ─── Sealed sender (Phase 1 — cacher le graphe au serveur) ────────────

/**
 * Résout l'expéditeur réel de messages via leurs blobs sealed sender et
 * remplace `sender_id` en place. Repli : si absent/illisible, `sender_id`
 * (encore peuplé en transition) est conservé.
 *
 * Anti-rejeu (v3) : quand la ligne porte `id` + `conversation_id` + `content`,
 * on reconstruit le contexte du message et on le passe à la vérification. Un
 * blob v3 recopié sur un AUTRE message (id/conversation/contenu différents)
 * échoue à la signature → l'expéditeur n'est PAS attribué.
 *
 * Bascule v2 (cf. `V2_SUNSET_ISO`) : pour un message dont `created_at` est ≥ à
 * la date de bascule, les blobs v2 (ou sans `v`) — non liés au message, donc
 * rejouables — sont REFUSÉS (l'expéditeur n'est pas attribué). Les messages
 * antérieurs restent résolus en v2 (rétrocompatibilité de l'historique).
 * `created_at` absent → refus non appliqué (on ne peut pas prouver le contraire).
 */
export async function resolveSealedSenders(
  rows: Array<{
    id?: string;
    sender_id?: string | null;
    conversation_id?: string;
    created_at?: string;
    content?: string;
    sender_sealed?: unknown;
    sender_x25519_key?: string | null;
    sender_identity_key?: string | null;
  }>,
  userId: string,
): Promise<void> {
  const sealedRows = rows.filter(
    r => Array.isArray(r.sender_sealed) && (r.sender_sealed as string[]).length > 0,
  );
  if (sealedRows.length === 0) return;

  let myPrivateKey: string;
  try {
    const kp = await getLocalX25519KeyPair(userId);
    if (!kp) return;
    myPrivateKey = kp.privateKey;
  } catch {
    return; // clés verrouillées → repli sender_id
  }

  // Clé publique de signature par expéditeur revendiqué (cache par lot).
  const signingKeyCache = new Map<string, string | null>();
  const getSigningKey = async (senderId: string): Promise<string | null> => {
    if (signingKeyCache.has(senderId)) return signingKeyCache.get(senderId) ?? null;
    let key: string | null = null;
    try {
      const { data } = await supabase
        .from('profiles')
        .select('ratchet_signing_key')
        .eq('id', senderId)
        .maybeSingle();
      key = data?.ratchet_signing_key ?? null;
    } catch {
      key = null;
    }
    signingKeyCache.set(senderId, key);
    return key;
  };

  await Promise.all(sealedRows.map(async r => {
    try {
      // Contexte du message (v3) : sans les 3 champs on ne peut PAS vérifier un
      // blob v3 (la signature couvre le contexte) → il sera rejeté, et seul un
      // blob v2 reste résoluble.
      let context: SealedSenderContext | undefined;
      if (
        typeof r.id === 'string' &&
        typeof r.conversation_id === 'string' &&
        typeof r.content === 'string'
      ) {
        context = {
          conversationId: r.conversation_id,
          messageId: r.id,
          contentHash: await sealedContentHash(r.content),
        };
      }
      // Vérifie la signature Ed25519 → empêche l'usurpation ET le rejeu.
      // Récupère aussi les clés publiques d'identité transportées dans le
      // payload (elles remplacent le stockage en clair de sender_public_key /
      // identityKey) : elles ne sont exploitées qu'APRÈS vérification.
      // Bascule v2 : un message postérieur à la date refuse les blobs v2
      // (non liés au message, donc rejouables).
      const resolved = await findVerifiedSenderIdentity(
        myPrivateKey,
        r.sender_sealed as string[],
        getSigningKey,
        context,
        { rejectUnboundV2: isAfterV2Sunset(r.created_at) },
      );
      if (resolved) {
        r.sender_id = resolved.senderId;
        if (resolved.x25519Key) r.sender_x25519_key = resolved.x25519Key;
        if (resolved.identityKey) r.sender_identity_key = resolved.identityKey;
      }
    } catch {
      // repli : on garde sender_id (authentifié par la RLS)
    }
  }));
}

/**
 * Scelle l'identité de l'expéditeur (v3, liée au message) puis l'attache à la
 * ligne `messages` déjà insérée (`sender_sealed`). À appeler APRÈS l'insertion
 * (l'`id` du message n'est connu qu'à ce moment). Best-effort : retourne `null`
 * si le scellement ou l'attache échoue (le message conserve alors `sender_id`
 * côté client ; le déchiffrement n'en dépend jamais).
 */
export async function sealSenderForMessage(params: {
  messageId: string;
  senderId: string;
  conversationId: string;
  content: string;
}): Promise<string[] | null> {
  const blobs = await buildSenderSealed(params.senderId, params.conversationId, {
    messageId: params.messageId,
    content: params.content,
  });
  if (!blobs) return null;
  try {
    const { error } = await supabase
      .from('messages')
      .update({ sender_sealed: blobs })
      .eq('id', params.messageId);
    if (error) {
      console.warn('[sealedSender] attache sender_sealed échouée:', error);
      return null;
    }
  } catch (e) {
    console.warn('[sealedSender] attache sender_sealed échouée:', e);
    return null;
  }
  return blobs;
}

/**
 * Construit les blobs sealed sender de l'expéditeur pour tous les membres
 * d'une conversation (v3 : signature liée au contexte du message − id,
 * conversation et hash du contenu − pour rendre le blob non rejouable).
 * Retourne `null` si impossible → le message conserve `sender_id` en clair.
 */
export async function buildSenderSealed(
  senderId: string,
  conversationId: string,
  ctx: { messageId: string; content: string },
): Promise<string[] | null> {
  try {
    // La clé de signature Ed25519 (ratchet) authentifie le scellé.
    const keys = await getLocalRatchetKeys(senderId);
    if (!keys?.signingKeyPair?.privateKey) return null; // pas de clé → repli sender_id

    const { data: members } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', conversationId);
    const ids = (members ?? [])
      .map((m: { user_id: string }) => m.user_id)
      .filter(Boolean);
    if (ids.length === 0) return null;

    const publicKeys = await fetchX25519PublicKeys(ids);
    const recipientKeys = ids
      .map(id => publicKeys.get(id))
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
    if (recipientKeys.length === 0) return null;

    const context: SealedSenderContext = {
      conversationId,
      messageId: ctx.messageId,
      contentHash: await sealedContentHash(ctx.content),
    };

    // Sealed sender : on transporte les clés publiques d'IDENTITÉ de
    // l'expéditeur DANS le payload scellé (au lieu de `sender_public_key` en
    // clair / `identityKey` dans les métadonnées) :
    //   • `xk` : clé publique X25519 (repli de déchiffrement des clés de
    //     message — robuste à une rotation de clé) ;
    //   • `ik` : clé publique d'identité ratchet X3DH (init de session).
    // Le scellé reste best-effort : sans elles, le destinataire dérive `xk` de
    // `profiles` et `ik` de `profiles.ratchet_identity_key`.
    let x25519Key: string | null = null;
    try {
      const localX = await getLocalX25519KeyPair(senderId);
      x25519Key = localX?.publicKey ?? null;
    } catch {
      x25519Key = null;
    }
    const identity: SealedSenderIdentity = {
      x25519Key,
      identityKey: keys.identityKeyPair?.publicKey ?? null,
    };

    return await sealSenderForMembers(
      recipientKeys,
      senderId,
      keys.signingKeyPair.privateKey,
      context,
      identity,
    );
  } catch (e) {
    console.warn('[sealedSender] build failed (repli sender_id):', e);
    return null;
  }
}
