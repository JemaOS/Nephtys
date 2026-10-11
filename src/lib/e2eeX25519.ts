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
import { isX25519PublicKey, tagX25519, type X25519KeyPair } from './x25519';

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

// ─── Cycle de vie de la paire (install / clear) ───────────────────────

/**
 * Installe une paire X25519 DÉJÀ DÉRIVÉE (récupération par phrase) : stockage
 * local + publication de la clé publique. **Aucune copie chiffrée serveur**
 * (modèle « zéro serveur »).
 */
export async function installX25519KeyPair(userId: string, keyPair: X25519KeyPair): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      x25519_public_key: keyPair.publicKey,
      x25519_public_key_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw error;
  await idbSet(idbKeyFor(userId), keyPair);
}

/** Efface la paire X25519 locale (aucun stockage serveur). */
export async function clearLocalX25519(userId: string): Promise<void> {
  await idbDelete(idbKeyFor(userId));
}

