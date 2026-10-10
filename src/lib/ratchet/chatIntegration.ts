// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Intégration du ratchet (forward secrecy) dans la messagerie.
 *
 * Le ratchet s'applique aux **conversations directes** (1:1) : le chiffrement
 * du texte y utilise X3DH + Double Ratchet au lieu de la clé statique
 * enveloppée par message. Toute indisponibilité (migration absente, clés non
 * initialisées, bundle manquant) → `null`, et l'appelant retombe sur la pile
 * X25519/P-256 existante : aucune régression.
 */

import { supabase } from '../supabase';
import { getLocalRatchetKeys, loadPeerBundle, markOneTimePreKeyUsed } from './keyStore';
import { loadSession, saveSession } from './sessionStore';
import { getCachedPlaintext, setCachedPlaintext } from './decryptCache';
import {
  decryptFromPeer,
  encryptForPeer,
  isRatchetEnvelope,
  type RatchetServiceDeps,
} from './service';

const deps: RatchetServiceDeps = {
  loadLocalKeys: getLocalRatchetKeys,
  loadPeerBundle,
  markOneTimePreKeyUsed,
  loadSession,
  saveSession,
};

/** Résout l'identifiant de l'unique pair d'une conversation directe, sinon null. */
async function directPeerId(userId: string, conversationId: string): Promise<string | null> {
  const { data: conv } = await supabase
    .from('conversations')
    .select('type')
    .eq('id', conversationId)
    .maybeSingle();
  if (conv?.type && conv.type !== 'direct') return null;

  const { data: members } = await supabase
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId);

  const others = (members ?? []).map(m => m.user_id).filter(id => id !== userId);
  return others.length === 1 ? others[0] : null;
}

/**
 * Tente de chiffrer un texte via le ratchet (conversation directe).
 * `plaintext` doit déjà être le payload sérialisé (texte + aperçu éventuel).
 * Retourne `null` si le ratchet n'est pas applicable.
 */
export async function tryEncryptWithRatchet(
  userId: string,
  conversationId: string,
  plaintext: string,
): Promise<{ content: string; encryptionMetadata: unknown } | null> {
  // Réactivé (2026-10-10) : le sealed sender RÉSOUT l'expéditeur réel
  // (`resolveSealedSenders`) AVANT le déchiffrement ratchet → les sessions sont
  // retrouvées même avec sender_id NULL. Et l'init se fait désormais SANS
  // one-time prekey (cf. service) → plus d'échec « one-time prekey
  // indisponible ». Repli automatique sur X25519 si indisponible.
  const RATCHET_SEND_ENABLED = true;
  if (!RATCHET_SEND_ENABLED) return null;

  try {
    const peerId = await directPeerId(userId, conversationId);
    if (!peerId) return null;
    if (!(await getLocalRatchetKeys(userId))) return null;

    const { content, envelope } = await encryptForPeer(deps, userId, peerId, plaintext);
    return { content, encryptionMetadata: envelope };
  } catch (e) {
    console.warn('[ratchet] chiffrement indisponible, repli sur X25519:', e);
    return null;
  }
}

/**
 * Déchiffre un message de ratchet si l'enveloppe en est un.
 * Retourne le payload brut (texte sérialisé) ou `null` si non applicable.
 */
export async function tryDecryptWithRatchet(
  metadata: unknown,
  content: string,
  userId: string,
  senderId: string,
): Promise<string | null> {
  if (!isRatchetEnvelope(metadata)) return null;
  // Idempotence : un message déjà déchiffré est renvoyé depuis le cache
  // (évite de ré-avancer la session ou de refaire X3DH au rechargement).
  const cached = await getCachedPlaintext(userId, content);
  if (cached !== null) return cached;
  try {
    const text = await decryptFromPeer(deps, userId, senderId, metadata, content);
    if (text !== null) await setCachedPlaintext(userId, content, text);
    return text;
  } catch (e) {
    console.warn('[ratchet] déchiffrement échoué:', e);
    return null;
  }
}

export { isRatchetEnvelope };
