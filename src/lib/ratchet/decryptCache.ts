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
 * IndexedDB persistant (survit au rechargement). Le payload en clair n'est pas
 * une exposition nouvelle : le contenu déchiffré des messages est déjà mis en
 * cache par l'app (offlineStorage).
 */

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
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(cacheKey(userId, content));
      req.onsuccess = () => resolve((req.result as string) ?? null);
      req.onerror = () => reject(req.error);
    });
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(payload, cacheKey(userId, content));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // best effort : le cache ne doit jamais faire échouer le déchiffrement
  }
}
