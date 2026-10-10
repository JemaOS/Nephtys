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
import {
  ensureUserKeyPair,
  encryptMedia,
  decryptMedia,
  wrapKeyForRecipient,
  unwrapKeyFromSender,
  fetchPublicKeys,
  cryptoB64,
  type WrappedKey,
} from './mediaEncryption';
import { fetchX25519PublicKeys, getLocalX25519KeyPair } from './e2eeX25519';
import { isX25519PublicKey, wrapKeyForRecipientX25519, unwrapKeyFromSenderX25519 } from './x25519';
import { isRatchetEnvelope, tryDecryptWithRatchet } from './ratchet/chatIntegration';

// Taille de bloc du rembourrage. Un message texte est rembourré au
// multiple de PAD_BLOCK supérieur, avec des octets aléatoires après la
// longueur réelle → l'observateur ne peut pas déduire la longueur.
const PAD_BLOCK = 256;
const LENGTH_PREFIX_BYTES = 4;
const ENVELOPE_VERSION = 1;

// ─── Cache de la paire de clés de l'utilisateur ───────────────────────
// Évite une lecture IndexedDB + une requête `profiles` par message lors du
// déchiffrement en masse (liste de conversations, historique).
type UserKeyPair = Awaited<ReturnType<typeof ensureUserKeyPair>>;
const keyPairCache = new Map<string, Promise<UserKeyPair>>();

function cachedKeyPair(userId: string): Promise<UserKeyPair> {
  let pending = keyPairCache.get(userId);
  if (!pending) {
    pending = ensureUserKeyPair(userId).catch(err => {
      // Ne pas mémoriser un échec (clés verrouillées) : on réessaiera.
      keyPairCache.delete(userId);
      throw err;
    });
    keyPairCache.set(userId, pending);
  }
  return pending;
}

/** Vide le cache de clés (à appeler à la déconnexion / verrouillage). */
export function clearTextKeyPairCache(): void {
  keyPairCache.clear();
}

// ─── Rembourrage ──────────────────────────────────────────────────────

/**
 * Sérialise une chaîne UTF-8 avec un préfixe de longueur (4 octets, BE)
 * puis complète avec des octets aléatoires jusqu'au multiple de PAD_BLOCK.
 */
function pad(plaintext: string): Uint8Array {
  const bytes = new TextEncoder().encode(plaintext);
  const withLength = new Uint8Array(LENGTH_PREFIX_BYTES + bytes.length);
  new DataView(withLength.buffer).setUint32(0, bytes.length, false);
  withLength.set(bytes, LENGTH_PREFIX_BYTES);

  const total = Math.max(
    PAD_BLOCK,
    Math.ceil(withLength.length / PAD_BLOCK) * PAD_BLOCK,
  );
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

  // Deux courbes cohabitent : on privilégie X25519 quand l'émetteur ET le
  // destinataire en possèdent une, sinon repli sur la pile P-256 historique.
  const senderX25519 = await getLocalX25519KeyPair(senderId);
  const x25519Publics = await fetchX25519PublicKeys(recipientIds);
  const p256Publics = await fetchPublicKeys(recipientIds);

  const missingKeys: string[] = [];
  const rows: any[] = [];
  let senderP256: UserKeyPair | null = null;

  for (const recipientId of recipientIds) {
    const recipientX25519 = x25519Publics.get(recipientId);
    const recipientP256 = p256Publics.get(recipientId);
    try {
      let wrapped: { encryptedKey: string; iv: string; senderPublicKey: string };
      if (senderX25519 && recipientX25519) {
        wrapped = await wrapKeyForRecipientX25519(
          rawKey,
          senderX25519.privateKey,
          senderX25519.publicKey,
          recipientX25519,
        );
      } else if (recipientP256) {
        if (!senderP256) senderP256 = await cachedKeyPair(senderId);
        wrapped = await wrapKeyForRecipient(
          rawKey,
          senderP256.privateKey,
          senderP256.publicKeyBase64,
          recipientP256,
        );
      } else {
        missingKeys.push(recipientId);
        continue;
      }
      rows.push({
        message_id: messageId,
        recipient_id: recipientId,
        encrypted_key: wrapped.encryptedKey,
        iv: wrapped.iv,
        sender_public_key: wrapped.senderPublicKey,
      });
    } catch (e) {
      console.error('[textEncryption] wrap failed for', recipientId, e);
      missingKeys.push(recipientId);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('message_text_keys').insert(rows);
    if (error) {
      console.error('[textEncryption] insert message_text_keys failed:', error);
      throw new Error('Échec de la sauvegarde des clés de chiffrement du message');
    }
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

/** Caches paresseux des paires de clés (une par courbe) pour un batch. */
interface UnwrapCaches {
  p256?: UserKeyPair | null;
  x25519?: Awaited<ReturnType<typeof getLocalX25519KeyPair>> | null;
}

/**
 * Déchiffre une clé AES enveloppée, en choisissant la courbe selon le tag de
 * `sender_public_key` : `x25519:...` → X25519, sinon P-256 (legacy).
 */
async function unwrapKeyRowForUser(
  keyRow: { encrypted_key: string; iv: string; sender_public_key: string },
  userId: string,
  caches: UnwrapCaches,
): Promise<Uint8Array> {
  const wrapped = {
    encryptedKey: keyRow.encrypted_key,
    iv: keyRow.iv,
    senderPublicKey: keyRow.sender_public_key,
  };

  if (isX25519PublicKey(wrapped.senderPublicKey)) {
    if (caches.x25519 === undefined) caches.x25519 = await getLocalX25519KeyPair(userId);
    if (!caches.x25519) throw new Error('Clé X25519 locale indisponible');
    return await unwrapKeyFromSenderX25519(wrapped, caches.x25519.privateKey);
  }

  if (caches.p256 === undefined) {
    try {
      caches.p256 = await cachedKeyPair(userId);
    } catch {
      caches.p256 = null;
    }
  }
  if (!caches.p256) throw new Error('Clé P-256 locale indisponible');
  return await unwrapKeyFromSender(wrapped as WrappedKey, caches.p256.privateKey);
}

/**
 * Déchiffre le contenu d'un message pour un utilisateur donné.
 * Retourne le texte en clair, ou `null` si le message n'est pas chiffré
 * ou si le déchiffrement est impossible (clé absente, pas de passphrase…).
 */
export async function decryptMessageContent(
  message: { id: string; content: string; is_text_encrypted?: boolean | null; encryption_metadata?: unknown; sender_id?: string },
  userId: string,
): Promise<string | null> {
  if (!message.is_text_encrypted) return message.content;

  // Chemin forward-secret (Double Ratchet) prioritaire.
  if (isRatchetEnvelope(message.encryption_metadata)) {
    const raw = await tryDecryptWithRatchet(
      message.encryption_metadata,
      message.content,
      userId,
      message.sender_id ?? '',
    );
    if (raw !== null) return parseTextPayload(raw).text;
    return UNDECRYPTABLE_PLACEHOLDER;
  }

  const envelope = parseEnvelope(message.encryption_metadata);
  if (!envelope) return UNDECRYPTABLE_PLACEHOLDER;

  let keyRow: { encrypted_key: string; iv: string; sender_public_key: string } | null = null;
  try {
    const { data, error } = await supabase
      .from('message_text_keys')
      .select('encrypted_key, iv, sender_public_key')
      .eq('message_id', message.id)
      .eq('recipient_id', userId)
      .maybeSingle();
    if (error) return UNDECRYPTABLE_PLACEHOLDER;
    keyRow = data;
  } catch (e) {
    console.warn('[textEncryption] key fetch failed for message', message.id, e);
    return UNDECRYPTABLE_PLACEHOLDER;
  }

  if (!keyRow) return UNDECRYPTABLE_PLACEHOLDER;

  try {
    const rawKey = await unwrapKeyRowForUser(keyRow, userId, {});
    return await decryptText(message.content, envelope.iv, rawKey);
  } catch (e) {
    console.warn('[textEncryption] decrypt failed for message', message.id, e);
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

  const encrypted = rows.filter(
    r => r.is_text_encrypted
      && (isRatchetEnvelope(r.encryption_metadata) || parseEnvelope(r.encryption_metadata)),
  );
  if (encrypted.length === 0) return rows;

  // On n'interroge les clés enveloppées QUE pour les messages non-ratchet.
  const wrappedIds = encrypted
    .filter(r => !isRatchetEnvelope(r.encryption_metadata))
    .map(r => r.id);

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

  await Promise.all(
    encrypted.map(async row => {
      // Chemin forward-secret (Double Ratchet).
      if (isRatchetEnvelope(row.encryption_metadata)) {
        const raw = await tryDecryptWithRatchet(
          row.encryption_metadata,
          row.content,
          userId,
          (row as any).sender_id ?? '',
        );
        if (raw !== null) {
          const payload = parseTextPayload(raw);
          row.content = payload.text;
          if (payload.linkPreview) (row as any).link_preview = JSON.stringify(payload.linkPreview);
        } else {
          row.content = UNDECRYPTABLE_PLACEHOLDER;
        }
        return;
      }

      const envelope = parseEnvelope(row.encryption_metadata);
      const keyRow = keyByMessage.get(row.id);
      if (!envelope || !keyRow) {
        row.content = UNDECRYPTABLE_PLACEHOLDER;
        return;
      }
      try {
        const rawKey = await unwrapKeyRowForUser(keyRow, userId, caches);
        const payload = await decryptTextPayload(row.content, envelope.iv, rawKey);
        row.content = payload.text;
        if (payload.linkPreview) {
          (row as any).link_preview = JSON.stringify(payload.linkPreview);
        }
      } catch (e) {
        console.warn('[textEncryption] batch decrypt failed for message', row.id, e);
        row.content = UNDECRYPTABLE_PLACEHOLDER;
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
