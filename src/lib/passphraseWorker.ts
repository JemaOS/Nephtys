// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Client du Web Worker PBKDF2. Renvoie `null` si le worker n'est pas disponible
 * (ex. jsdom/serveur) pour laisser l'appelant retomber sur le thread principal.
 *
 * Distinction d'erreurs : une erreur de crypto (mauvaise passphrase) est
 * propagée telle quelle ; une erreur d'infrastructure worker est taguée
 * `name = 'WorkerUnavailable'` pour déclencher le repli.
 */

import type { EncryptedPrivateKey } from './passphraseCrypto';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function unavailable(): Error {
  const e = new Error('pbkdf2 worker unavailable');
  e.name = 'WorkerUnavailable';
  return e;
}

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../workers/pbkdf2.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = (e.data || {}) as {
        id: number; result?: unknown; error?: string;
      };
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(result);
    };
    worker.onerror = () => {
      for (const [, p] of pending) p.reject(unavailable());
      pending.clear();
      try { worker?.terminate(); } catch { /* ignore */ }
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

function call(payload: Record<string, unknown>): Promise<unknown> | null {
  const w = getWorker();
  if (!w) return null;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      w.postMessage({ id, ...payload });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : unavailable());
    }
  });
}

export function workerEncrypt(
  privateKeyPkcs8Base64: string,
  passphrase: string,
): Promise<EncryptedPrivateKey> | null {
  return call({ op: 'encrypt', privateKeyPkcs8Base64, passphrase }) as Promise<EncryptedPrivateKey> | null;
}

export function workerDecrypt(
  encrypted: EncryptedPrivateKey,
  passphrase: string,
): Promise<string> | null {
  return call({ op: 'decrypt', encrypted, passphrase }) as Promise<string> | null;
}
