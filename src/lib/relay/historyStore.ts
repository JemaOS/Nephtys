// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Historique **local** des conversations privées (robustesse).
 *
 * Le relais ne conserve rien (par conception). Pour ne pas perdre l'historique
 * au rechargement, les messages privés sont stockés **uniquement sur l'appareil**
 * (IndexedDB). Aucune donnée n'est envoyée nulle part.
 *
 * Note : ceci est de la persistance locale, PAS de la synchronisation
 * multi-appareil (qui exigerait une synchro chiffrée de clés/état).
 */

import { sealAtRest, openAtRest, isAtRestBox } from '../atRestCrypto';

export interface PrivateMessageRecord {
  conversationId: string;
  id: string;
  text: string;
  mine: boolean;
  ts: number;
}

export interface PrivateHistoryStore {
  load(conversationId: string): Promise<PrivateMessageRecord[]>;
  append(record: PrivateMessageRecord): Promise<void>;
  clear(conversationId: string): Promise<void>;
}

/** Implémentation mémoire (tests). */
export class InMemoryHistoryStore implements PrivateHistoryStore {
  private readonly byConversation = new Map<string, PrivateMessageRecord[]>();

  async load(conversationId: string): Promise<PrivateMessageRecord[]> {
    return [...(this.byConversation.get(conversationId) ?? [])];
  }

  async append(record: PrivateMessageRecord): Promise<void> {
    const list = this.byConversation.get(record.conversationId) ?? [];
    list.push(record);
    this.byConversation.set(record.conversationId, list);
  }

  async clear(conversationId: string): Promise<void> {
    this.byConversation.delete(conversationId);
  }
}

/** Implémentation IndexedDB (production). */
export class IdbHistoryStore implements PrivateHistoryStore {
  private readonly dbName = 'nephtys-private-history';
  private readonly storeName = 'messages';

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.storeName)) {
          const store = req.result.createObjectStore(this.storeName, { keyPath: 'id' });
          store.createIndex('conversationId', 'conversationId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async load(conversationId: string): Promise<PrivateMessageRecord[]> {
    const db = await this.open();
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const index = tx.objectStore(this.storeName).index('conversationId');
      const req = index.getAll(conversationId);
      req.onsuccess = () => resolve((req.result as unknown[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    const out: PrivateMessageRecord[] = [];
    for (const row of rows) {
      // `openAtRest` déchiffre le nouveau format ; l'ancien (clair) est rendu
      // tel quel → rétrocompatible.
      const rec = (await openAtRest(row)) as PrivateMessageRecord | undefined;
      if (rec && typeof rec === 'object' && typeof rec.text === 'string') out.push(rec);
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  async append(record: PrivateMessageRecord): Promise<void> {
    const db = await this.open();
    const sealed = await sealAtRest(record);
    // `id`/`conversationId` restent en clair : requis par le keyPath et l'index
    // IndexedDB. Le reste (dont le TEXTE) est chiffré au repos.
    const stored = isAtRestBox(sealed)
      ? { ...sealed, id: record.id, conversationId: record.conversationId }
      : record;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(stored);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(conversationId: string): Promise<void> {
    const db = await this.open();
    const rows = await this.load(conversationId);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const store = tx.objectStore(this.storeName);
      for (const row of rows) store.delete(row.id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
