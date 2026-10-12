// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Persistance locale des sessions Double Ratchet (IndexedDB).
 *
 * Une session par (utilisateur, pair). Base IndexedDB dédiée pour ne pas
 * entrer en conflit de version avec les autres stores E2EE.
 *
 * L'état de session est du MATÉRIEL SENSIBLE (clé racine, clés de chaîne,
 * clé privée de ratchet) : il est chiffré « au repos » via `sealAtRestStrict` /
 * `openAtRest` (même modèle que `keyStore` / `e2eeX25519`). Le chiffrement est
 * **strict** : en cas d'indisponibilité, l'écriture ÉCHOUE explicitement — on
 * n'écrit JAMAIS l'état de session en clair. Les entrées historiques stockées
 * en clair restent lisibles (rétrocompat) et sont re-chiffrées à la prochaine
 * écriture. La CLÉ IndexedDB (`userId|peerId`) reste en clair : elle est
 * hors-ligne (out-of-line) et c'est elle qui indexe la session, pas un champ du
 * enregistrement.
 *
 * Le store contient aussi les ÉPINGLES « ce pair a publié une clé PQ » (anti-
 * downgrade post-quantique côté émetteur, cf. `service.encryptForPeer`).
 */

import type { SessionState } from './doubleRatchet';
import { sealAtRestStrict, openAtRest } from '../atRestCrypto';

const DB_NAME = 'nephtys-ratchet-sessions';
const STORE = 'sessions';
const PIN_STORE = 'pqpins';
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(PIN_STORE)) db.createObjectStore(PIN_STORE);
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
  // Matériel SENSIBLE (clé racine, clés de chaîne, clé privée de ratchet) →
  // chiffrement « au repos » STRICT : `sealAtRestStrict` ÉCHOUE explicitement
  // si le chiffrement est indisponible, plutôt que de retomber (comme le
  // best-effort `sealAtRest`) sur l'écriture de l'état EN CLAIR.
  const stored = await sealAtRestStrict(state);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(stored, sessionKey(userId, peerId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Épingle qu'un pair a publié une clé ML-KEM (PQ-capable). Sert à détecter un
 * downgrade côté émetteur : si le bundle du pair perd ensuite sa clé PQ, la
 * session est refusée au lieu d'être établie en X25519 classique silencieux.
 */
export async function pinPeerPq(userId: string, peerId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PIN_STORE, 'readwrite');
    tx.objectStore(PIN_STORE).put(true, sessionKey(userId, peerId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Vrai si le pair est épinglé comme PQ-capable (cf. `pinPeerPq`). */
export async function isPeerPqPinned(userId: string, peerId: string): Promise<boolean> {
  try {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(PIN_STORE, 'readonly');
      const req = tx.objectStore(PIN_STORE).get(sessionKey(userId, peerId));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return raw === true;
  } catch {
    // Pin indisponible → on ne bloque PAS l'envoi (pas de faux positif).
    return false;
  }
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
 * Supprime TOUTES les sessions de l'utilisateur (toutes les conversations),
 * ainsi que les épingles PQ associées.
 *
 * Indispensable au « Réinitialiser le chiffrement » : sans cela, des sessions
 * périmées restaient en IndexedDB et faisaient échouer le déchiffrement
 * (OperationError / clé divergente). Les épingles PQ sont effacées avec elles :
 * après un reset, on ré-épinglera le pair à partir de son bundle courant.
 */
export async function clearUserSessions(userId: string): Promise<void> {
  try {
    const db = await openDb();
    const prefix = `${userId}|`;
    const readKeys = (storeName: string): Promise<string[]> =>
      new Promise<string[]>((resolve) => {
        const tx = db.transaction(storeName, 'readonly');
        const req = tx.objectStore(storeName).getAllKeys();
        req.onsuccess = () => resolve((req.result as string[]) ?? []);
        req.onerror = () => resolve([]);
      });

    const [keys, pinKeys] = await Promise.all([readKeys(STORE), readKeys(PIN_STORE)]);
    await new Promise<void>((resolve) => {
      const tx = db.transaction([STORE, PIN_STORE], 'readwrite');
      const sessions = tx.objectStore(STORE);
      const pins = tx.objectStore(PIN_STORE);
      for (const k of keys) if (k.startsWith(prefix)) sessions.delete(k);
      for (const k of pinKeys) if (k.startsWith(prefix)) pins.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // best-effort
  }
}
