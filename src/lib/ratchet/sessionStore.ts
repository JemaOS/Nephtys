// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Persistance locale des sessions Double Ratchet (IndexedDB).
 *
 * Une session par (utilisateur, pair). Base IndexedDB dédiée pour ne pas
 * entrer en conflit de version avec les autres stores E2EE.
 *
 * L'état de session est du MATÉRIEL SENSIBLE (clé racine, clés de chaîne,
 * clé privée de ratchet) : il est chiffré « au repos » via `sealAtRest` /
 * `openAtRest` (même modèle que `keyStore` / `e2eeX25519` / `decryptCache`).
 * Les entrées historiques stockées en clair restent lisibles (rétrocompat) et
 * sont re-chiffrées à la prochaine écriture. La CLÉ IndexedDB (`userId|peerId`)
 * reste en clair : elle est hors-ligne (out-of-line) et c'est elle qui indexe
 * la session, pas un champ du enregistrement.
 */

import type { SessionState } from './doubleRatchet';
import { sealAtRest, openAtRest } from '../atRestCrypto';

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
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(sessionKey(userId, peerId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (raw == null) return null;
    // `openAtRest` déchiffre les enregistrements scellés et renvoie TEL QUEL
    // l'ancien format historique en clair (rétrocompatibilité). `undefined` =
    // boîte indéchiffrable (clé au repos perdue) → traité comme session absente
    // (l'app refera X3DH plutôt que de dériver un état corrompu).
    const opened = await openAtRest(raw);
    return (opened as SessionState | undefined) ?? null;
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
  // Chiffrement « au repos » de l'état de session (clés de chaîne, clé privée
  // de ratchet). `sealAtRest` est best-effort : il retombe sur la valeur brute
  // si le chiffrement au repos est indisponible (pas de régression d'envoi), et
  // reste rétrocompatible avec les enregistrements en clair déjà présents.
  const stored = await sealAtRest(state);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(stored, sessionKey(userId, peerId));
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

/**
 * Supprime TOUTES les sessions de l'utilisateur (toutes les conversations).
 *
 * Indispensable au « Réinitialiser le chiffrement » : sans cela, des sessions
 * périmées restaient en IndexedDB et faisaient échouer le déchiffrement
 * (OperationError / clé divergente).
 */
export async function clearUserSessions(userId: string): Promise<void> {
  try {
    const db = await openDb();
    const keys = await new Promise<string[]>((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => resolve([]);
    });
    const prefix = `${userId}|`;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const k of keys) if (k.startsWith(prefix)) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}
