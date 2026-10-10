// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * P4 — Synchro chiffrée multi-appareil (foundation).
 *
 * Range/lit des blobs DÉJÀ chiffrés côté client dans `user_encrypted_state`
 * (RLS propriétaire). Le serveur ne voit que du ciphertext opaque.
 *
 * Usage futur : lier un 2e appareil (QR) → il récupère ces blobs et les
 * déchiffre avec le mot de passe. Aucun service supplémentaire.
 */

import { supabase } from './supabase';

/** Enregistre (ou remplace) un blob chiffré pour la clé donnée. */
export async function putEncryptedState(userId: string, key: string, blob: string): Promise<void> {
  const { error } = await supabase
    .from('user_encrypted_state')
    .upsert(
      { user_id: userId, key, blob, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' },
    );
  if (error) throw new Error(`encryptedState.put: ${error.message}`);
}

/** Récupère un blob chiffré (ou `null` s'il n'existe pas). */
export async function getEncryptedState(userId: string, key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('user_encrypted_state')
    .select('blob')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();
  if (error) throw new Error(`encryptedState.get: ${error.message}`);
  return data?.blob ?? null;
}

/** Liste les clés d'état disponibles pour l'utilisateur. */
export async function listEncryptedStateKeys(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('user_encrypted_state')
    .select('key')
    .eq('user_id', userId);
  if (error) throw new Error(`encryptedState.list: ${error.message}`);
  return (data ?? []).map((r: { key: string }) => r.key);
}

/** Supprime un blob d'état. */
export async function deleteEncryptedState(userId: string, key: string): Promise<void> {
  const { error } = await supabase
    .from('user_encrypted_state')
    .delete()
    .eq('user_id', userId)
    .eq('key', key);
  if (error) throw new Error(`encryptedState.delete: ${error.message}`);
}
