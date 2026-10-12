// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Chiffrement « au repos » STRICT de l'état de session ratchet et du cache de
 * déchiffrement : jamais de matériel/clair écrit en clair, échec explicite si
 * le scellement est indisponible.
 *
 * jsdom ne fournit pas d'IndexedDB → on installe un shim minimal en mémoire
 * (suffisant pour `get/put/delete/getAllKeys` + transactions), tandis que
 * `crypto.subtle` (AES-GCM) est le vrai.
 */

import { describe, it, expect, vi } from 'vitest';

const mockState = vi.hoisted(() => ({ strictFails: false }));

vi.mock('../atRestCrypto', async importOriginal => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sealAtRestStrict: async (value: unknown) => {
      if (mockState.strictFails) throw new Error('at-rest sealing unavailable (test)');
      return actual.sealAtRestStrict(value);
    },
  };
});

type Store = Map<unknown, unknown>;

function makeFakeIndexedDB() {
  const dbs = new Map<string, { version: number; stores: Map<string, Store> }>();
  return {
    __dbs: dbs,
    open(name: string, version = 1) {
      const req: any = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null };
      const record = dbs.get(name) ?? { version: 0, stores: new Map<string, Store>() };
      dbs.set(name, record);
      queueMicrotask(() => {
        const db: any = {
          objectStoreNames: { contains: (n: string) => record.stores.has(n) },
          createObjectStore: (n: string) => {
            record.stores.set(n, new Map());
            return {};
          },
          transaction: (names: string | string[]) => {
            const list = Array.isArray(names) ? names : [names];
            const tx: any = {};
            tx.objectStore = (n: string) => {
              const store = record.stores.get(n);
              if (!store) throw new Error(`store ${n} inexistant`);
              const makeReq = (fn: () => unknown) => {
                const r: any = {};
                queueMicrotask(() => {
                  r.result = fn();
                  r.onsuccess?.();
                });
                return r;
              };
              return {
                get: (k: unknown) => makeReq(() => store.get(k)),
                put: (v: unknown, k: unknown) => makeReq(() => void store.set(k, v)),
                delete: (k: unknown) => makeReq(() => void store.delete(k)),
                getAllKeys: () => makeReq(() => Array.from(store.keys())),
              };
            };
            // oncomplete est une macrotâche : il s'exécute APRÈS les requêtes
            // (microtâches) de la transaction.
            setTimeout(() => tx.oncomplete?.(), 0);
            return tx;
          },
        };
        req.result = db;
        if (record.version < version) {
          record.version = version;
          req.onupgradeneeded?.();
        }
        req.onsuccess?.();
      });
      return req;
    },
  };
}

const fakeIdb = makeFakeIndexedDB();
(globalThis as any).indexedDB = fakeIdb;

import { isAtRestBox } from '../atRestCrypto';
import { saveSession, loadSession, pinPeerPq, isPeerPqPinned, clearUserSessions } from './sessionStore';
import { setCachedPlaintext, getCachedPlaintext } from './decryptCache';
import type { SessionState } from './doubleRatchet';

function sampleSession(): SessionState {
  return {
    rootKey: 'root-key-b64',
    selfRatchetPrivateKey: 'priv-b64',
    selfRatchetPublicKey: 'pub-b64',
    remoteRatchetPublicKey: 'remote-b64',
    sendingChainKey: 'send-chain-b64',
    receivingChainKey: 'recv-chain-b64',
    sendCount: 3,
    previousSendCount: 1,
    receiveCount: 2,
    skipped: { 'x|0': 'skipped-b64' },
    associatedData: 'ad-b64',
  };
}

function rawSession(userId: string, peerId: string): unknown {
  const db = fakeIdb.__dbs.get('nephtys-ratchet-sessions');
  return db?.stores.get('sessions')?.get(`${userId}|${peerId}`);
}

function rawPin(userId: string, peerId: string): unknown {
  const db = fakeIdb.__dbs.get('nephtys-ratchet-sessions');
  return db?.stores.get('pqpins')?.get(`${userId}|${peerId}`);
}

describe('2. sessionStore — scellement STRICT de l\'état de session', () => {
  it('chiffre l\'état au repos (jamais en clair) et le relit à l\'identique', async () => {
    const state = sampleSession();
    await saveSession('u1', 'p1', state);

    const raw = rawSession('u1', 'p1');
    expect(isAtRestBox(raw)).toBe(true);
    // Le JSON en clair ne doit PAS apparaître dans l'enregistrement.
    expect(JSON.stringify(raw)).not.toContain('root-key-b64');
    expect(JSON.stringify(raw)).not.toContain('priv-b64');

    expect(await loadSession('u1', 'p1')).toEqual(state);
  });

  it('ÉCHOUE explicitement si le scellement est indisponible (pas d\'écriture en clair)', async () => {
    mockState.strictFails = true;
    try {
      await expect(saveSession('u2', 'p2', sampleSession())).rejects.toThrow(/sealing unavailable/);
      // Rien n'a été écrit : ni boîte scellée, ni clair.
      expect(rawSession('u2', 'p2')).toBeUndefined();
      expect(await loadSession('u2', 'p2')).toBeNull();
    } finally {
      mockState.strictFails = false;
    }
  });
});

describe('2b. sessionStore — épinglage PQ', () => {
  it('épingle un pair PQ et l\'efface avec « reset chiffrement »', async () => {
    expect(await isPeerPqPinned('u3', 'p3')).toBe(false);
    await pinPeerPq('u3', 'p3');
    expect(await isPeerPqPinned('u3', 'p3')).toBe(true);
    expect(rawPin('u3', 'p3')).toBe(true);
    expect(await isPeerPqPinned('u3', 'autre')).toBe(false);

    await clearUserSessions('u3');
    expect(await isPeerPqPinned('u3', 'p3')).toBe(false);
  });
});

describe('2c. decryptCache — scellement STRICT du clair mis en cache', () => {
  it('écrit le cache scellé, et n\'écrit RIEN (pas de clair) si le scellement échoue', async () => {
    mockState.strictFails = true;
    try {
      await setCachedPlaintext('u9', 'ct', 'clair-secret');
      expect(await getCachedPlaintext('u9', 'ct')).toBeNull();
    } finally {
      mockState.strictFails = false;
    }

    await setCachedPlaintext('u9', 'ct', 'clair-secret');
    expect(await getCachedPlaintext('u9', 'ct')).toBe('clair-secret');
  });
});
