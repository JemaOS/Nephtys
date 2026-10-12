// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/** Persistance locale (IndexedDB) des statuts privés (éphémères). */

import { activeStatuses, isExpired, type StatusRecord } from './statusStore';
import { sealAtRest, openAtRest } from '../atRestCrypto';

const DB_NAME = 'nephtys-private-statuses';
const STORE = 'statuses';

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

export class IdbStatusStore {
  async save(record: StatusRecord): Promise<void> {
    const db = await openDb();
    const stored = await sealAtRest(record);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stored, record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async all(): Promise<StatusRecord[]> {
    const db = await openDb();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const out: StatusRecord[] = [];
    for (const row of rows) {
      // Rétrocompatible : l'ancien format (objet en clair) est rendu tel quel.
      const rec = (await openAtRest(row)) as StatusRecord | undefined;
      if (rec && typeof rec === 'object' && typeof rec.id === 'string') out.push(rec);
    }
    return out;
  }

  /** Statuts encore valides (non expirés), du plus récent au plus ancien. */
  async active(): Promise<StatusRecord[]> {
    return activeStatuses(await this.all());
  }

  /** Supprime un statut par son identifiant. */
  async remove(id: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Supprime les statuts expirés. */
  async prune(now = Date.now()): Promise<void> {
    const db = await openDb();
    const all = await this.all();
    const expired = all.filter(s => isExpired(s, now)).map(s => s.id);
    if (expired.length === 0) return;
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const id of expired) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
