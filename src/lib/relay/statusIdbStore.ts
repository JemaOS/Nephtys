// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/** Persistance locale (IndexedDB) des statuts privés (éphémères). */

import { activeStatuses, isExpired, type StatusRecord } from './statusStore';

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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record, record.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async all(): Promise<StatusRecord[]> {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StatusRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  /** Statuts encore valides (non expirés), du plus récent au plus ancien. */
  async active(): Promise<StatusRecord[]> {
    return activeStatuses(await this.all());
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
