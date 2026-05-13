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

  // 2. Récupère les clés publiques
  const publicKeys = await fetchPublicKeys(recipientIds);

  // 3. Pour chaque destinataire ayant une clé publique, wrap la clé AES
  const sender = await ensureUserKeyPair(senderId);
  const missingKeys: string[] = [];
  const rows: any[] = [];

  for (const recipientId of recipientIds) {
    const recipientPubB64 = publicKeys.get(recipientId);
    if (!recipientPubB64) {
      missingKeys.push(recipientId);
      continue;
    }
    try {
      const wrapped = await wrapKeyForRecipient(
        rawKey,
        sender.privateKey,
        sender.publicKeyBase64,
        recipientPubB64
      );
      rows.push({
        message_id: messageId,
        recipient_id: recipientId,
        encrypted_key: wrapped.encryptedKey,
        iv: wrapped.iv,
        sender_public_key: wrapped.senderPublicKey,
        media_iv: mediaIvBase64,
      });
    } catch (e) {
      console.error('[encryptedMediaService] wrap failed for', recipientId, e);
      missingKeys.push(recipientId);
    }
  }

  if (rows.length > 0) {
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
  }

  return { inserted: rows.length, missingKeys };
}

// ─── Téléchargement + déchiffrement ───────────────────────────────────

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

  const wrapped: WrappedKey = {
    encryptedKey: keyRow.encrypted_key,
    iv: keyRow.iv,
    senderPublicKey: keyRow.sender_public_key,
  };

  // 2. Déchiffre la clé AES
  const myKeyPair = await ensureUserKeyPair(userId);
  const rawKey = await unwrapKeyFromSender(wrapped, myKeyPair.privateKey);

  // 3. Télécharge le binaire chiffré (signed URL)
  const { data: signed, error: signError } = await supabase.storage
    .from('media')
    .createSignedUrl(mediaPath, 60); // 1 min suffit pour download
  if (signError || !signed?.signedUrl) {
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
