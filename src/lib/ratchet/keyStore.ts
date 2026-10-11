// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Gestion des clés X3DH/Double Ratchet de l'utilisateur.
 *
 *   • Matériel privé (identité DH, clé de signature, signed prekey, one-time
 *     prekeys, ML-KEM) : **IndexedDB local uniquement**, dérivé de la phrase
 *     de récupération. **Aucune copie serveur.**
 *   • Bundle public : publié dans `profiles.ratchet_*` + one-time prekeys
 *     dans la table `one_time_prekeys`.
 */

import { supabase } from '../supabase';
import { signPreKey } from './x3dh';
import type { LocalRatchetKeys, PeerBundle } from './service';
import { clearUserSessions } from './sessionStore';

const DB_NAME = 'nephtys-ratchet-keys';
const STORE = 'keys';
const IDB_KEY_PREFIX = 'ratchet-keys-v1';

// ─── IndexedDB local ──────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(userId: string): Promise<LocalRatchetKeys | undefined> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(`${IDB_KEY_PREFIX}:${userId}`);
    req.onsuccess = () => resolve(req.result as LocalRatchetKeys | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(userId: string, keys: LocalRatchetKeys): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(keys, `${IDB_KEY_PREFIX}:${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(userId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(`${IDB_KEY_PREFIX}:${userId}`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/** Lecture locale seule (pas de réseau) — utilisée par le service ratchet. */
export async function getLocalRatchetKeys(userId: string): Promise<LocalRatchetKeys | null> {
  try {
    return (await idbGet(userId)) ?? null;
  } catch {
    return null;
  }
}

// ─── Publication du bundle public ─────────────────────────────────────

async function publishKeys(userId: string, keys: LocalRatchetKeys): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ratchet_identity_key: keys.identityKeyPair.publicKey,
      ratchet_signing_key: keys.signingKeyPair.publicKey,
      ratchet_signed_prekey: keys.signedPreKey.publicKey,
      ratchet_signed_prekey_sig: signPreKey(keys.signingKeyPair.privateKey, keys.signedPreKey.publicKey, keys.mlKemKeyPair?.publicKey),
      ml_kem_public_key: keys.mlKemKeyPair?.publicKey ?? null,
      ratchet_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) {
    if (error.message?.includes('ratchet_') || error.message?.includes('ml_kem')) {
      throw new Error('Migration manquante : applique 20261010_ratchet_prekeys.sql / ml_kem');
    }
    throw error;
  }

  // (Re)publie les one-time prekeys disponibles.
  const rows = Object.keys(keys.oneTimePreKeys).map(publicKey => ({
    user_id: userId,
    public_key: publicKey,
    is_used: false,
  }));
  const { error: opkError } = await supabase
    .from('one_time_prekeys')
    .upsert(rows, { onConflict: 'user_id,public_key', ignoreDuplicates: false });
  if (opkError) throw opkError;
}

/**
 * Installe un matériel ratchet DÉJÀ DÉRIVÉ (récupération par phrase) : stockage
 * local + publication du bundle public. **Aucune copie chiffrée n'est envoyée
 * au serveur** (modèle « zéro serveur » : la clé privée reste locale).
 */
export async function installRatchetKeys(userId: string, keys: LocalRatchetKeys): Promise<void> {
  await idbSet(userId, keys);
  await publishKeys(userId, keys);
}

/**
 * Efface le matériel ratchet LOCAL (IndexedDB + sessions + OPKs serveur) sans
 * rien uploader — utilisé avant de rebasculer sur une nouvelle phrase.
 */
export async function clearLocalRatchetKeys(userId: string): Promise<void> {
  await idbDelete(userId);
  await clearUserSessions(userId);
  await supabase.from('one_time_prekeys').delete().eq('user_id', userId);
}

/** Bundle public d'un pair + une one-time prekey disponible. */
export async function loadPeerBundle(peerId: string): Promise<PeerBundle | null> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('ratchet_identity_key, ratchet_signing_key, ratchet_signed_prekey, ratchet_signed_prekey_sig, ml_kem_public_key')
    .eq('id', peerId)
    .maybeSingle();
  if (error || !profile?.ratchet_identity_key) return null;

  const { data: opk } = await supabase
    .from('one_time_prekeys')
    .select('public_key')
    .eq('user_id', peerId)
    .eq('is_used', false)
    .limit(1)
    .maybeSingle();

  return {
    identityKey: profile.ratchet_identity_key,
    signingKey: profile.ratchet_signing_key,
    signedPreKey: profile.ratchet_signed_prekey,
    signedPreKeySignature: profile.ratchet_signed_prekey_sig,
    oneTimePreKey: opk?.public_key ?? null,
    mlKemPublicKey: (profile as { ml_kem_public_key?: string | null }).ml_kem_public_key ?? null,
  };
}

export async function markOneTimePreKeyUsed(peerId: string, oneTimePreKey: string): Promise<void> {
  // Depuis le durcissement RLS, la consommation d'une one-time prekey passe par
  // un RPC atomique (l'UPDATE direct n'est plus autorisé et échouait en
  // silence). On résout l'id puis on consomme — une seule ligne, jamais de
  // réécriture de `public_key`.
  const { data } = await supabase
    .from('one_time_prekeys')
    .select('id')
    .eq('user_id', peerId)
    .eq('public_key', oneTimePreKey)
    .eq('is_used', false)
    .maybeSingle();

  if (!data?.id) return;

  const { error } = await supabase.rpc('consume_one_time_prekey', { p_prekey_id: data.id });
  if (error) {
    console.warn('[ratchet] consume_one_time_prekey failed:', error.message);
  }
}
