// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Service haut niveau pour upload/download de médias chiffrés E2EE.
 *
 * Usage typique :
 *
 *   // À l'envoi :
 *   const { path, mediaIv } = await uploadEncryptedMedia(file, conversationId, userId);
 *   // ... insère le message avec media_url=path, is_media_encrypted=true
 *   // ... insère ensuite les wrapped keys (voir createMediaKeysForMessage)
 *
 *   // À la lecture :
 *   const blobUrl = await fetchAndDecryptMedia(messageId, mediaPath, mediaIv, userId);
 *   <img src={blobUrl} />
 */

import { supabase } from './supabase';
import { extractStoragePath } from './mediaUrl';
import { encryptMedia, decryptMedia, cryptoB64 } from './mediaEncryption';
import { getLocalX25519KeyPair, fetchX25519PublicKeys } from './e2eeX25519';
import { wrapKeyForRecipientX25519, unwrapKeyFromSenderX25519, keyWrapAad } from './x25519';
import { offlineStorage } from './offlineStorage';
import { resolveSealedSenders, tryUnwrapWithMemberKeys } from './textEncryption';

// ─── Cache local des blobURL déchiffrés ───────────────────────────────

const decryptedBlobCache = new Map<string, { url: string; expiresAt: number }>();
const BLOB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

// ─── Upload chiffré ───────────────────────────────────────────────────

export interface EncryptedUploadResult {
  /** Path dans le bucket (à stocker dans messages.media_url) */
  path: string;
  /** IV du chiffrement du média (à stocker dans message_media_keys.media_iv) */
  mediaIvBase64: string;
  /** Clé AES brute, à utiliser pour wrapKeyForRecipient(...) */
  rawKey: Uint8Array;
  /** Taille du fichier original (pour affichage UX) */
  originalSize: number;
}

/**
 * Chiffre un fichier puis l'upload dans le bucket sous forme de binaire opaque.
 * Le serveur ne voit que des octets aléatoires, mais on conserve le MIME type
 * d'origine du fichier pour passer la whitelist du bucket. Le contenu reste
 * indéchiffrable sans la clé AES.
 */
export async function uploadEncryptedMedia(
  file: Blob | File,
  pathPrefix: string
): Promise<EncryptedUploadResult> {
  const { ciphertext, rawKey, iv } = await encryptMedia(file);

  // On garde l'extension d'origine du path (ex. .jpg, .mp4) pour rester
  // compatible avec la whitelist MIME du bucket. Le serveur voit "image/jpeg"
  // mais le binaire est en réalité chiffré : aucune image décodable sans la clé.
  const originalMime = file.type || 'application/octet-stream';
  const blob = new Blob([ciphertext as BlobPart], { type: originalMime });

  const { error } = await supabase.storage
    .from('media')
    .upload(pathPrefix, blob, {
      cacheControl: '3600',
      upsert: false,
      contentType: originalMime,
    });

  if (error) {
    throw new Error(`Upload chiffré échoué : ${error.message}`);
  }

  return {
    path: pathPrefix,
    mediaIvBase64: cryptoB64.toBase64(iv.buffer as ArrayBuffer),
    rawKey,
    originalSize: file.size,
  };
}

// ─── Création des clés enveloppées pour un message ────────────────────

/**
 * Pour un message qui vient d'être inséré, génère et stocke les clés
 * enveloppées pour chaque destinataire (incluant l'expéditeur lui-même
 * pour qu'il puisse re-déchiffrer ses propres médias).
 */
export async function createMediaKeysForMessage(params: {
  messageId: string;
  senderId: string;
  conversationId: string;
  rawKey: Uint8Array;
  mediaIvBase64: string;
}): Promise<{ inserted: number; missingKeys: string[] }> {
  const { messageId, senderId, conversationId, rawKey, mediaIvBase64 } = params;

  // 1. Liste des destinataires = tous les membres actifs de la conv
  const { data: members } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  const recipientIds = members?.map(m => m.user_id) ?? [];
  if (recipientIds.length === 0) {
    return { inserted: 0, missingKeys: [] };
  }

  // 2. Récupère les clés publiques X25519
  const publicKeys = await fetchX25519PublicKeys(recipientIds);

  // 3. Pour chaque destinataire ayant une clé publique, wrap la clé AES (X25519)
  const sender = await getLocalX25519KeyPair(senderId);
  if (!sender) throw new Error('Clés E2EE locales absentes (X25519).');
  const missingKeys: string[] = [];
  const rows: any[] = [];

  for (const recipientId of recipientIds) {
    const recipientPubB64 = publicKeys.get(recipientId);
    if (!recipientPubB64) {
      missingKeys.push(recipientId);
      continue;
    }
    try {
      const wrapped = await wrapKeyForRecipientX25519(
        rawKey,
        sender.privateKey,
        sender.publicKey,
        recipientPubB64,
        keyWrapAad(sender.publicKey),
      );
      rows.push({
        message_id: messageId,
        recipient_id: recipientId,
        encrypted_key: wrapped.encryptedKey,
        iv: wrapped.iv,
        // ⚠️ Sealed sender : plus de clé publique STABLE de l'expéditeur en
        // clair (elle permettait au serveur de retrouver l'auteur). Transportée
        // dans le payload sealed sender v3 ou dérivée côté destinataire. La
        // colonne reste (nullable) pour l'ancien trafic.
        media_iv: mediaIvBase64,
      });
    } catch (e) {
      console.error('[encryptedMediaService] wrap failed for', recipientId, e);
      missingKeys.push(recipientId);
    }
  }

  if (rows.length === 0) {
    // Fail-closed : aucune clé enveloppée créée. Le média (déjà chiffré) ne
    // serait déchiffrable par personne ; on remonte l'erreur plutôt que de
    // laisser passer un message cassé.
    throw new Error('Échec du chiffrement : aucune clé média n\'a pu être créée');
  }

  const { error } = await supabase
    .from('message_media_keys')
    .insert(rows);
  if (error) {
    if (error.message?.includes('message_media_keys')) {
      console.error(
        '[E2EE] Table message_media_keys manquante. Applique la migration 20260513_e2ee_media_keys.sql avant d\'envoyer des m\u00e9dias chiffr\u00e9s.'
      );
    } else {
      console.error('[E2EE] failed to insert media keys:', error);
    }
    throw new Error('Échec de la sauvegarde des clés de chiffrement');
  }

  return { inserted: rows.length, missingKeys };
}

// ─── Téléchargement + déchiffrement ───────────────────────────────────

/**
 * Résout la clé publique X25519 de l'expéditeur d'un message média dont
 * `message_media_keys.sender_public_key` est NULL (nouveau trafic, sealed
 * sender) :
 *   1. clé transportée par le payload sealed sender v3 de la ligne `messages`
 *      (vérifiée : signature Ed25519 + contexte du message) — robuste à une
 *      rotation de clé de l'expéditeur ;
 *   2. repli : dérivation depuis `profiles.x25519_public_key(sender_id)`.
 * Retourne aussi `conversationId` (pour le repli « clé d'un membre ») et `null`
 * comme clé si introuvable (média indéchiffrable).
 */
async function resolveMediaSenderKey(
  messageId: string,
  userId: string,
): Promise<{ senderPublicKey: string | null; conversationId?: string }> {
  let row: {
    id: string;
    conversation_id?: string;
    content?: string;
    sender_id?: string | null;
    sender_sealed?: unknown;
    sender_x25519_key?: string | null;
    created_at?: string;
  } | null = null;
  let conversationId: string | undefined;
  try {
    const { data } = await supabase
      .from('messages')
      .select('id, conversation_id, content, sender_id, sender_sealed, created_at')
      .eq('id', messageId)
      .maybeSingle();
    if (!data) return { senderPublicKey: null };
    conversationId = (data as any).conversation_id ?? undefined;
    row = {
      id: data.id,
      conversation_id: conversationId,
      content: typeof (data as any).content === 'string' ? (data as any).content : undefined,
      sender_id: (data as any).sender_id ?? null,
      sender_sealed: (data as any).sender_sealed,
      created_at: typeof (data as any).created_at === 'string' ? (data as any).created_at : undefined,
    };
    await resolveSealedSenders([row], userId);
  } catch {
    return { senderPublicKey: null, conversationId };
  }
  if (row.sender_x25519_key) return { senderPublicKey: row.sender_x25519_key, conversationId };
  if (!row.sender_id) return { senderPublicKey: null, conversationId };
  try {
    const { data: prof } = await supabase
      .from('profiles')
      .select('x25519_public_key')
      .eq('id', row.sender_id)
      .maybeSingle();
    const key = (prof as any)?.x25519_public_key;
    return {
      senderPublicKey: typeof key === 'string' && key.length > 0 ? key : null,
      conversationId,
    };
  } catch {
    return { senderPublicKey: null, conversationId };
  }
}

/**
 * Résout la clé AES brute d'un média, dans l'ordre :
 *   1. `sender_public_key` (colonne, ancien trafic) ;
 *   2. payload sealed sender v3 (`xk`) puis `profiles(sender_id)` ;
 *   3. REPLI : clé publique d'un MEMBRE de la conversation (l'enveloppe est liée
 *      par AAD à la clé de l'expéditeur → une seule candidate déchiffre, celle
 *      de l'expéditeur).
 * Retourne `null` si aucune clé ne déchiffre.
 */
async function resolveMediaRawKey(
  keyRow: { encrypted_key: string; iv: string; sender_public_key: string | null },
  messageId: string,
  userId: string,
): Promise<Uint8Array | null> {
  const myKeyPair = await getLocalX25519KeyPair(userId);
  if (!myKeyPair) return null;

  const tryUnwrap = async (senderPublicKey: string): Promise<Uint8Array | null> => {
    try {
      return await unwrapKeyFromSenderX25519(
        { encryptedKey: keyRow.encrypted_key, iv: keyRow.iv, senderPublicKey },
        myKeyPair.privateKey,
        keyWrapAad(senderPublicKey),
      );
    } catch {
      return null;
    }
  };

  if (keyRow.sender_public_key) {
    const rawKey = await tryUnwrap(keyRow.sender_public_key);
    if (rawKey) return rawKey;
  }

  const resolved = await resolveMediaSenderKey(messageId, userId);
  if (resolved.senderPublicKey) {
    const rawKey = await tryUnwrap(resolved.senderPublicKey);
    if (rawKey) return rawKey;
  }

  const candidate = await tryUnwrapWithMemberKeys(keyRow, resolved.conversationId, userId, {
    myPrivateKey: myKeyPair.privateKey,
  });
  return candidate?.rawKey ?? null;
}

/**
 * Récupère la clé enveloppée pour un message, télécharge le binaire chiffré,
 * le déchiffre, et retourne un blob URL utilisable dans <img src>, <video>, etc.
 */
export async function fetchAndDecryptMedia(
  messageId: string,
  mediaPath: string,
  userId: string
): Promise<string> {
  // Cache
  const cacheKey = `${messageId}:${userId}`;
  const cached = decryptedBlobCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  // 0. Cache durable local (IndexedDB) : un média déjà déchiffré reste
  // disponible même si l'objet a été purgé du serveur (rétention). Et ça
  // évite tout accès réseau pour un média déjà vu.
  try {
    const local = await offlineStorage.getMediaBlob(messageId);
    if (local) {
      const url = URL.createObjectURL(local.blob);
      decryptedBlobCache.set(cacheKey, { url, expiresAt: Date.now() + BLOB_CACHE_TTL_MS });
      return url;
    }
  } catch {
    // ignore : on retombe sur le réseau
  }

  // 1. Récupère la clé enveloppée
  const { data: keyRow, error: keyError } = await supabase
    .from('message_media_keys')
    .select('encrypted_key, iv, sender_public_key, media_iv')
    .eq('message_id', messageId)
    .eq('recipient_id', userId)
    .maybeSingle();

  if (keyError || !keyRow) {
    throw new Error(`Clé de chiffrement introuvable pour le message ${messageId}`);
  }

  // Clé AES : colonne (ancien) → payload sealed v3 / profiles → REPLI « clé
  // d'un membre de la conversation » (identifie l'expéditeur).
  const rawKey = await resolveMediaRawKey(keyRow, messageId, userId);
  if (!rawKey) {
    throw new Error(`Clé publique de l'expéditeur introuvable pour le message ${messageId}`);
  }

  // 3. Télécharge le binaire chiffré (signed URL).
  // mediaPath peut être déjà une URL signée (le helper de loadMessages aura
  // pré-signé) ou un path nu : on extrait toujours le path avant de re-signer.
  const cleanPath = extractStoragePath(mediaPath);
  const { data: signed, error: signError } = await supabase.storage
    .from('media')
    .createSignedUrl(cleanPath, 60);
  if (signError || !signed?.signedUrl) {
    console.error('[E2EE] createSignedUrl failed for', cleanPath, signError);
    throw new Error('Impossible de générer une URL signée pour le binaire chiffré');
  }

  const response = await fetch(signed.signedUrl);
  if (!response.ok) {
    throw new Error(`Téléchargement du binaire chiffré échoué : ${response.status}`);
  }
  const ciphertext = new Uint8Array(await response.arrayBuffer());

  // 4. Déchiffre le binaire
  const mediaIv = new Uint8Array(cryptoB64.fromBase64(keyRow.media_iv));
  const plaintext = await decryptMedia(ciphertext, rawKey, mediaIv);

  // 5. Crée un blob URL
  const blob = new Blob([plaintext as BlobPart]);
  const url = URL.createObjectURL(blob);
  decryptedBlobCache.set(cacheKey, { url, expiresAt: Date.now() + BLOB_CACHE_TTL_MS });

  // 6. Persiste le blob en clair localement (cache durable, local-first).
  // Best-effort : les gros fichiers peuvent échouer (quota) sans casser l'affichage.
  try {
    await offlineStorage.saveMediaBlob(messageId, blob);
  } catch {
    // ignore
  }

  return url;
}

/**
 * Libère le blob URL d'un message déchiffré.
 */
export function releaseDecryptedMedia(messageId: string, userId: string): void {
  const cacheKey = `${messageId}:${userId}`;
  const cached = decryptedBlobCache.get(cacheKey);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    decryptedBlobCache.delete(cacheKey);
  }
}

export function clearAllDecryptedMedia(): void {
  decryptedBlobCache.forEach(v => URL.revokeObjectURL(v.url));
  decryptedBlobCache.clear();
}

// ─── Récupération de la clé AES brute (pour transfert) ────────────────

/**
 * Récupère la clé AES brute d'un message chiffré pour un utilisateur donné.
 * Utile lors du transfert d'un message E2EE : on déchiffre la clé du message
 * source puis on la re-wrap pour les membres de la conversation cible.
 *
 * Retourne { rawKey, mediaIvBase64 } ou null si la clé est introuvable.
 */
export async function fetchMediaRawKey(
  messageId: string,
  userId: string
): Promise<{ rawKey: Uint8Array; mediaIvBase64: string } | null> {
  // 1. Récupère la clé enveloppée
  const { data: keyRow, error: keyError } = await supabase
    .from('message_media_keys')
    .select('encrypted_key, iv, sender_public_key, media_iv')
    .eq('message_id', messageId)
    .eq('recipient_id', userId)
    .maybeSingle();

  if (keyError || !keyRow) {
    console.warn('[fetchMediaRawKey] key not found for message', messageId);
    return null;
  }

  // Clé AES : colonne (ancien) → payload sealed v3 / profiles → REPLI « clé
  // d'un membre de la conversation » (identifie l'expéditeur).
  const rawKey = await resolveMediaRawKey(keyRow, messageId, userId);
  if (!rawKey) {
    console.warn('[fetchMediaRawKey] clé publique expéditeur introuvable pour', messageId);
    return null;
  }

  return { rawKey, mediaIvBase64: keyRow.media_iv };
}
