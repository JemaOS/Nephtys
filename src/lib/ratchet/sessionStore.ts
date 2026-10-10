// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Persistance locale des sessions Double Ratchet (IndexedDB).
 *
 * Une session par (utilisateur, pair). Base IndexedDB dédiée pour ne pas
 * entrer en conflit de version avec les autres stores E2EE.
 */

import type { SessionState } from './doubleRatchet';

const DB_NAME = 'nephtys-ratchet-sessions';
const STORE = 'sessions';

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

function sessionKey(userId: string, peerId: string): string {
  return `${userId}|${peerId}`;
}

export async function loadSession(userId: string, peerId: string): Promise<SessionState | null> {
  try {
    const db = await openDb();
    return await new Promise<SessionState | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sessionKey(userId, peerId));
      req.onsuccess = () => resolve((req.result as SessionState) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveSession(
  userId: string,
  peerId: string,
  state: SessionState,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, sessionKey(userId, peerId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSession(userId: string, peerId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(sessionKey(userId, peerId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
