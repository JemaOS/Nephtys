// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Gestion des clés X25519 de l'utilisateur (complément à `mediaEncryption`,
 * qui gère la pile P-256 historique).
 *
 * Modèle de clés — identique à la pile P-256, mais colonnes et emplacement
 * IndexedDB dédiés pour cohabiter sans casser l'existant :
 *   • clé publique  → profiles.x25519_public_key  (taguée `x25519:`)
 *   • clé privée    → IndexedDB local, ET copie chiffrée par mot de passe
 *                     dans user_key_material.x25519_private_key / _salt / _iv
 *                     (table propriétaire, RLS `user_id = auth.uid()`).
 *
 * Objectif : permettre au chiffrement du texte d'utiliser X25519 quand les
 * deux parties l'ont, avec **repli automatique** sur P-256 sinon. Aucune
 * donnée existante n'est invalidée.
 */

import { supabase } from './supabase';
import {
  decryptPrivateKeyWithPassphrase,
  encryptPrivateKeyWithPassphrase,
} from './passphraseKeyStore';
import { fetchKeyMaterial, upsertKeyMaterial } from './keyMaterial';
import {
  deriveX25519PublicKey,
  generateX25519KeyPair,
  isX25519PublicKey,
  tagX25519,
  type X25519KeyPair,
} from './x25519';

const IDB_NAME = 'nephtys-e2ee';
const IDB_STORE = 'private-keys';
const IDB_KEY_PREFIX = 'x25519-private-key-v1';

// ─── IndexedDB ────────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<X25519KeyPair | undefined> {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as X25519KeyPair | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: X25519KeyPair): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

function idbKeyFor(userId: string): string {
  return `${IDB_KEY_PREFIX}:${userId}`;
}

// ─── Lecture locale (pas de réseau) ───────────────────────────────────

/**
 * Récupère la paire X25519 locale du user si présente en IndexedDB.
 * Retourne `null` sinon (l'appelant doit alors retomber sur P-256).
 */
export async function getLocalX25519KeyPair(userId: string): Promise<X25519KeyPair | null> {
  try {
    const cached = await idbGet(idbKeyFor(userId));
    if (!cached?.privateKey || !cached?.publicKey) return null;
    return { publicKey: tagX25519(cached.publicKey), privateKey: cached.privateKey };
  } catch {
    return null;
  }
}

// ─── Clés publiques distantes ─────────────────────────────────────────

/**
 * Récupère les clés publiques X25519 publiées d'un ensemble d'utilisateurs.
 * Ne contient que les users ayant une clé X25519 valide.
 */
export async function fetchX25519PublicKeys(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, x25519_public_key')
    .in('id', userIds)
    .not('x25519_public_key', 'is', null);
  if (error) {
    // Migration non appliquée → aucune clé X25519, repli P-256 côté appelant.
    return map;
  }
  data?.forEach((p: any) => {
    if (isX25519PublicKey(p.x25519_public_key)) map.set(p.id, p.x25519_public_key);
  });
  return map;
}

// ─── Cycle de vie de la paire (setup / unlock / reset) ────────────────

/**
 * Crée (ou reprend) la paire X25519, la chiffre avec le mot de passe et
 * publie le matériel. Idempotent : préserve une paire déjà publiée.
 */
export async function setupX25519KeyPair(userId: string, password: string): Promise<X25519KeyPair> {
  const keyMat = await fetchKeyMaterial(userId);

  const remoteHasKey = !!(
    keyMat?.x25519_private_key &&
    keyMat?.x25519_salt &&
    keyMat?.x25519_iv
  );
  if (remoteHasKey) {
    return await unlockX25519KeyPair(userId, password);
  }

  // Préserve une paire locale existante si présente, sinon en génère une.
  const local = await idbGet(idbKeyFor(userId));
  const keyPair: X25519KeyPair = local?.privateKey
    ? { publicKey: deriveX25519PublicKey(local.privateKey), privateKey: local.privateKey }
    : generateX25519KeyPair();

  const enc = await encryptPrivateKeyWithPassphrase(keyPair.privateKey, password);
  const { error } = await supabase
    .from('profiles')
    .update({
      x25519_public_key: keyPair.publicKey,
      x25519_public_key_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) {
    if (error.message?.includes('x25519_')) {
      throw new Error('Migration manquante : applique 20261010_x25519_profiles.sql');
    }
    throw error;
  }
  await upsertKeyMaterial(userId, {
    x25519_private_key: enc.encryptedPrivateKey,
    x25519_salt: enc.salt,
    x25519_iv: enc.iv,
  });

  await idbSet(idbKeyFor(userId), keyPair);
  return keyPair;
}

/**
 * Déverrouille la paire X25519 sur un device : télécharge la privée chiffrée,
 * la déchiffre avec le mot de passe, la stocke en IndexedDB local.
 */
export async function unlockX25519KeyPair(userId: string, password: string): Promise<X25519KeyPair> {
  const [{ data: profile }, keyMat] = await Promise.all([
    supabase.from('profiles').select('x25519_public_key').eq('id', userId).maybeSingle(),
    fetchKeyMaterial(userId),
  ]);

  if (!keyMat?.x25519_private_key || !keyMat?.x25519_salt || !keyMat?.x25519_iv) {
    throw new Error('Aucune clé X25519 chiffrée en DB pour cet utilisateur.');
  }

  const privateKey = await decryptPrivateKeyWithPassphrase(
    {
      encryptedPrivateKey: keyMat.x25519_private_key,
      salt: keyMat.x25519_salt,
      iv: keyMat.x25519_iv,
    },
    password,
  );

  const publicKey = profile?.x25519_public_key && isX25519PublicKey(profile.x25519_public_key)
    ? profile.x25519_public_key
    : deriveX25519PublicKey(privateKey);

  const keyPair: X25519KeyPair = { publicKey, privateKey };
  await idbSet(idbKeyFor(userId), keyPair);
  return keyPair;
}

/** Réinitialise la paire (les anciens messages X25519 deviennent illisibles). */
export async function resetX25519KeyPair(userId: string, newPassword: string): Promise<X25519KeyPair> {
  await idbDelete(idbKeyFor(userId));
  await upsertKeyMaterial(userId, {
    x25519_private_key: null,
    x25519_salt: null,
    x25519_iv: null,
  });
  return await setupX25519KeyPair(userId, newPassword);
}

// ─── Initialisation silencieuse (mêmes hooks que la pile P-256) ───────

/** À la création de compte : génère + publie la paire X25519 (silencieux). */
export async function initX25519OnSignup(userId: string, password: string): Promise<void> {
  try {
    await setupX25519KeyPair(userId, password);
  } catch (err) {
    console.error('[E2EE][x25519] initX25519OnSignup failed (migration ?)', err);
  }
}

/** À la connexion : restaure la paire X25519 avec le mot de passe (silencieux). */
export async function initX25519OnSignin(userId: string, password: string): Promise<void> {
  try {
    const keyMat = await fetchKeyMaterial(userId);

    const remoteHasKey = !!(
      keyMat?.x25519_private_key &&
      keyMat?.x25519_salt &&
      keyMat?.x25519_iv
    );

    if (remoteHasKey) {
      try {
        await unlockX25519KeyPair(userId, password);
      } catch {
        console.warn('[E2EE][x25519] Déchiffrement échoué (mot de passe ?)');
      }
    } else {
      await setupX25519KeyPair(userId, password);
    }
  } catch (err) {
    console.error('[E2EE][x25519] initX25519OnSignin failed', err);
  }
}
