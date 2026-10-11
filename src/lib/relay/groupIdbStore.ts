// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/** Persistance locale (IndexedDB) des groupes privés. */

import {
  serializeGroupRecord,
  deserializeGroupRecord,
  type GroupRecord,
  type GroupStore,
} from './groupMessenger';
import { sealAtRest, openAtRest } from '../atRestCrypto';

const DB_NAME = 'nephtys-private-groups';
const STORE = 'groups';

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

export class IdbGroupStore implements GroupStore {
  async load(groupId: string): Promise<GroupRecord | null> {
    const db = await openDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(groupId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // Rétrocompatible : l'ancien format (chaîne en clair) est rendu tel quel.
    const value = await openAtRest(raw);
    return typeof value === 'string' && value ? deserializeGroupRecord(value) : null;
  }

  async save(record: GroupRecord): Promise<void> {
    const db = await openDb();
    const stored = await sealAtRest(serializeGroupRecord(record));
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(stored, record.groupId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async list(): Promise<GroupRecord[]> {
    const db = await openDb();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const out: GroupRecord[] = [];
    for (const row of rows) {
      const value = await openAtRest(row);
      if (typeof value === 'string' && value) out.push(deserializeGroupRecord(value));
    }
    return out;
  }

  async remove(groupId: string): Promise<void> {
    const db = await openDb();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(groupId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }
}
