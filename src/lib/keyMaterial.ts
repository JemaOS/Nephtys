// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Matériel de clés PRIVÉES de l'utilisateur, isolé dans une table propriétaire.
 *
 * Historiquement ces colonnes étaient sur `public.profiles`, lisible par tout
 * compte authentifié (découverte) → n'importe quel utilisateur connecté pouvait
 * lire les clés privées chiffrées des autres (fuite corrigée le 2026-10-10).
 *
 * Désormais stockées dans `public.user_key_material` avec une RLS stricte
 * `user_id = auth.uid()` : chaque utilisateur ne voit QUE sa propre ligne.
 *
 * @module keyMaterial
 */

import { supabase } from './supabase';

export interface KeyMaterial {
  encrypted_private_key: string | null;
  private_key_salt: string | null;
  private_key_iv: string | null;
  x25519_private_key: string | null;
  x25519_salt: string | null;
  x25519_iv: string | null;
  ratchet_keys_encrypted: string | null;
  ratchet_keys_salt: string | null;
  ratchet_keys_iv: string | null;
}

const TABLE = 'user_key_material';

/** Lit le matériel de clés de l'utilisateur (RLS : uniquement sa propre ligne). */
export async function fetchKeyMaterial(userId: string): Promise<KeyMaterial | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as KeyMaterial;
}

/** Écrit (crée ou met à jour) le matériel de clés de l'utilisateur. */
export async function upsertKeyMaterial(
  userId: string,
  patch: Partial<KeyMaterial>,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert(
      { user_id: userId, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw error;
}
