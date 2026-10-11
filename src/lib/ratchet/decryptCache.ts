// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Cache d'idempotence du déchiffrement ratchet.
 *
 * Problème (révélé par test 2-appareils) : re-déchiffrer le MÊME message
 * ratchet ré-avance la session (`OperationError`) ou refait X3DH alors que la
 * one-time prekey est mono-usage (« one-time prekey déjà consommée »). Le
 * message devient illisible au rechargement.
 *
 * Correctif : mémoriser le payload déchiffré, indexé par le ciphertext (unique
 * par message), pour qu'un message ne soit déchiffré **qu'une fois**.
 *
 * IndexedDB persistant (survit au rechargement). Le payload est chiffré au
 * repos (cf. `atRestCrypto`) : ce n'est plus du clair brut sur disque. Le
 * contenu déchiffré des messages est de toute façon déjà mis en cache par
 * l'app (offlineStorage), lui aussi chiffré au repos.
 */

import { sealAtRest, openAtRest } from '../atRestCrypto';

const DB_NAME = 'nephtys-ratchet-decrypt';
const STORE = 'plaintexts';

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

function cacheKey(userId: string, content: string): string {
  return `${userId}|${content}`;
}

export async function getCachedPlaintext(
  userId: string,
  content: string,
): Promise<string | null> {
  try {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(userId, content));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (raw == null) return null;
    // `openAtRest` déchiffre les entrées chiffrées et renvoie telles quelles les
    // entrées historiques en clair (rétrocompatibilité). `undefined` = boîte
    // indéchiffrable (clé au repos perdue) → traité comme un cache manquant.
    const opened = await openAtRest(raw);
    return typeof opened === 'string' ? opened : null;
  } catch {
    return null;
  }
}

export async function setCachedPlaintext(
  userId: string,
  content: string,
  payload: string,
): Promise<void> {
  try {
    const db = await openDb();
    const stored = await sealAtRest(payload);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stored, cacheKey(userId, content));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best effort : le cache ne doit jamais faire échouer le déchiffrement
  }
}
