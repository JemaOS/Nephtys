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
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const index = tx.objectStore(this.storeName).index('conversationId');
      const req = index.getAll(conversationId);
      req.onsuccess = () => {
        const rows = (req.result as PrivateMessageRecord[]) ?? [];
        resolve(rows.sort((a, b) => a.ts - b.ts));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async append(record: PrivateMessageRecord): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(record);
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
