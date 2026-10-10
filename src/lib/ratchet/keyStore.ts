// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Gestion des clés X3DH/Double Ratchet de l'utilisateur.
 *
 *   • Matériel privé (identité DH, clé de signature, signed prekey,
 *     one-time prekeys) : stocké en IndexedDB local, ET copie chiffrée par
 *     mot de passe dans `user_key_material.ratchet_keys_*`.
 *   • Bundle public : publié dans `profiles.ratchet_*` + one-time prekeys
 *     dans la table `one_time_prekeys`.
 *
 * Mêmes hooks d'init silencieuse que les piles P-256 / X25519.
 */

import { supabase } from '../supabase';
import {
  decryptPrivateKeyWithPassphrase,
  encryptPrivateKeyWithPassphrase,
} from '../passphraseKeyStore';
import { fetchKeyMaterial, upsertKeyMaterial } from '../keyMaterial';
import {
  signPreKey,
} from './x3dh';
import { base64ToBytes, bytesToBase64 } from './primitives';
import { generateLocalRatchetKeys, type LocalRatchetKeys, type PeerBundle } from './service';

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

// ─── Encodage du blob privé ───────────────────────────────────────────

function encodeKeys(keys: LocalRatchetKeys): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(keys)));
}

function decodeKeys(b64: string): LocalRatchetKeys {
  return JSON.parse(new TextDecoder().decode(base64ToBytes(b64))) as LocalRatchetKeys;
}

// ─── Génération ───────────────────────────────────────────────────────

function generateLocalKeys(): LocalRatchetKeys {
  return generateLocalRatchetKeys();
}

/** Lecture locale seule (pas de réseau) — utilisée par le service ratchet. */
export async function getLocalRatchetKeys(userId: string): Promise<LocalRatchetKeys | null> {
  try {
    return (await idbGet(userId)) ?? null;
  } catch {
    return null;
  }
}

// ─── Publication / récupération serveur ───────────────────────────────

async function publishKeys(userId: string, keys: LocalRatchetKeys): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ratchet_identity_key: keys.identityKeyPair.publicKey,
      ratchet_signing_key: keys.signingKeyPair.publicKey,
      ratchet_signed_prekey: keys.signedPreKey.publicKey,
      ratchet_signed_prekey_sig: signPreKey(keys.signingKeyPair.privateKey, keys.signedPreKey.publicKey),
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

async function persistEncrypted(userId: string, keys: LocalRatchetKeys, password: string): Promise<void> {
  const enc = await encryptPrivateKeyWithPassphrase(encodeKeys(keys), password);
  await upsertKeyMaterial(userId, {
    ratchet_keys_encrypted: enc.encryptedPrivateKey,
    ratchet_keys_salt: enc.salt,
    ratchet_keys_iv: enc.iv,
  });
}

async function fetchEncrypted(userId: string) {
  const km = await fetchKeyMaterial(userId);
  if (!km?.ratchet_keys_encrypted || !km.ratchet_keys_salt || !km.ratchet_keys_iv) return null;
  return { encryptedPrivateKey: km.ratchet_keys_encrypted, salt: km.ratchet_keys_salt, iv: km.ratchet_keys_iv };
}

/**
 * Crée (ou reprend) le matériel ratchet, le chiffre avec le mot de passe et
 * publie le bundle. Idempotent.
 */
export async function setupRatchetKeys(userId: string, password: string): Promise<LocalRatchetKeys> {
  const enc = await fetchEncrypted(userId);
  if (enc) return await unlockRatchetKeys(userId, password);

  const keys = (await idbGet(userId)) ?? generateLocalKeys();
  await persistEncrypted(userId, keys, password);
  await publishKeys(userId, keys);
  await idbSet(userId, keys);
  return keys;
}

/** Déverrouille le matériel ratchet sur un nouveau device via le mot de passe. */
export async function unlockRatchetKeys(userId: string, password: string): Promise<LocalRatchetKeys> {
  const enc = await fetchEncrypted(userId);
  if (!enc) throw new Error('Aucune clé ratchet chiffrée en DB pour cet utilisateur.');
  const keys = decodeKeys(await decryptPrivateKeyWithPassphrase(enc, password));
  await idbSet(userId, keys);
  return keys;
}

/** Réinitialise le matériel ratchet (perte des sessions/anciens messages). */
export async function resetRatchetKeys(userId: string, password: string): Promise<LocalRatchetKeys> {
  await idbDelete(userId);
  await supabase
    .from('one_time_prekeys')
    .delete()
    .eq('user_id', userId);
  await upsertKeyMaterial(userId, {
    ratchet_keys_encrypted: null,
    ratchet_keys_salt: null,
    ratchet_keys_iv: null,
  });
  return await setupRatchetKeys(userId, password);
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
  await supabase
    .from('one_time_prekeys')
    .update({ is_used: true })
    .eq('user_id', peerId)
    .eq('public_key', oneTimePreKey);
}

// ─── Initialisation silencieuse ───────────────────────────────────────

export async function initRatchetOnSignup(userId: string, password: string): Promise<void> {
  try {
    await setupRatchetKeys(userId, password);
  } catch (err) {
    console.error('[E2EE][ratchet] initRatchetOnSignup failed (migration ?)', err);
  }
}

export async function initRatchetOnSignin(userId: string, password: string): Promise<void> {
  try {
    const enc = await fetchEncrypted(userId);
    if (enc) {
      try {
        await unlockRatchetKeys(userId, password);
      } catch {
        console.warn('[E2EE][ratchet] Déchiffrement échoué (mot de passe ?)');
      }
    } else {
      await setupRatchetKeys(userId, password);
    }
  } catch (err) {
    console.error('[E2EE][ratchet] initRatchetOnSignin failed', err);
  }
}
