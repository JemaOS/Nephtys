// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Stockage **local uniquement** des connexions en mode privé.
 *
 * La correspondance conversation ↔ (files du relais) ↔ (clés/session ratchet)
 * ne vit QUE sur l'appareil : le serveur n'en sait rien. C'est le point clé
 * du modèle SimpleX — pas de graphe social côté serveur.
 */

import type { LocalRatchetKeys } from '../ratchet/service';
import type { SessionState } from '../ratchet/doubleRatchet';
import type { RelayConnection } from './relayTransport';

export interface PendingInit {
  identityKey: string;
  ephemeralPublicKey: string;
  usedOneTimePreKey: string | null;
}

export interface PrivateConnectionRecord {
  conversationId: string;
  relay: RelayConnection;
  localKeys: LocalRatchetKeys;
  session: SessionState | null;
  /** Champs X3DH à joindre au premier message sortant (initiateur). */
  pendingInit: PendingInit | null;
}

export interface PrivateConnectionStore {
  load(conversationId: string): Promise<PrivateConnectionRecord | null>;
  save(record: PrivateConnectionRecord): Promise<void>;
  remove(conversationId: string): Promise<void>;
  list(): Promise<PrivateConnectionRecord[]>;
}

/** Implémentation mémoire (tests). */
export class InMemoryConnectionStore implements PrivateConnectionStore {
  private readonly records = new Map<string, PrivateConnectionRecord>();

  async load(conversationId: string): Promise<PrivateConnectionRecord | null> {
    return this.records.get(conversationId) ?? null;
  }

  async save(record: PrivateConnectionRecord): Promise<void> {
    this.records.set(record.conversationId, record);
  }

  async remove(conversationId: string): Promise<void> {
    this.records.delete(conversationId);
  }

  async list(): Promise<PrivateConnectionRecord[]> {
    return [...this.records.values()];
  }
}

/** Implémentation IndexedDB (production). */
export class IdbConnectionStore implements PrivateConnectionStore {
  private readonly dbName = 'nephtys-private-connections';
  private readonly storeName = 'connections';

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(this.storeName)) {
          req.result.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async load(conversationId: string): Promise<PrivateConnectionRecord | null> {
    const db = await this.open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).get(conversationId);
      req.onsuccess = () => resolve((req.result as PrivateConnectionRecord) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async save(record: PrivateConnectionRecord): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put(record, record.conversationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async remove(conversationId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>(resolve => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(conversationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  async list(): Promise<PrivateConnectionRecord[]> {
    const db = await this.open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve((req.result as PrivateConnectionRecord[]) ?? []);
      req.onerror = () => reject(req.error);
    });
  }
}
