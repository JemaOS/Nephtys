// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Serveur relais auto-hébergeable (modèle SimpleX/SMP).
 *
 *   node server/relay.mjs            # écoute sur ws://0.0.0.0:8090
 *   RELAY_PORT=9000 node server/relay.mjs
 *
 * Garanties de confidentialité :
 *   • aucune notion d'utilisateur/identité (que des files opaques) ;
 *   • files unidirectionnelles (clé d'envoi ≠ clé de réception) ;
 *   • aucun contenu en clair : le relais ne stocke que du ciphertext E2EE ;
 *   • stockage volatil avec TTL (le relais n'est pas une base de données).
 *
 * Le cœur est volontairement identique à `src/lib/relay/relayCore.ts`
 * (dupliqué ici car ce script tourne hors du bundler TypeScript).
 */

import { WebSocketServer } from 'ws';

const PORT = Number(process.env.RELAY_PORT ?? 8090);
const HOST = process.env.RELAY_HOST ?? '0.0.0.0';
const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_QUEUE = 1000;

function randomToken(bytes = 16) {
  return globalThis.crypto.getRandomValues(new Uint8Array(bytes));
}

function tokenString(bytes = 16) {
  return Buffer.from(randomToken(bytes)).toString('base64url');
}

/** @type {Map<string, {sendKey:string, rcvKey:string, messages:Array<{id:string,ciphertext:string,ts:number,expiresAt:number}>}>} */
const queues = new Map();

function evict(queue) {
  const now = Date.now();
  if (queue.messages.length && queue.messages[0].expiresAt <= now) {
    queue.messages = queue.messages.filter(m => m.expiresAt > now);
  }
}

function handle(op) {
  switch (op?.op) {
    case 'createQueue': {
      const queue = { queueId: tokenString(), sendKey: tokenString(), rcvKey: tokenString(), messages: [] };
      queues.set(queue.queueId, queue);
      return { ok: true, result: { queueId: queue.queueId, sendKey: queue.sendKey, rcvKey: queue.rcvKey } };
    }
    case 'send': {
      const queue = queues.get(op.queueId);
      if (!queue || queue.sendKey !== op.queueKey) return { ok: false, error: 'unauthorized' };
      evict(queue);
      if (queue.messages.length >= MAX_MESSAGES_PER_QUEUE) return { ok: false, error: 'queue-full' };
      const id = tokenString(9);
      queue.messages.push({ id, ciphertext: String(op.ciphertext ?? ''), ts: Date.now(), expiresAt: Date.now() + MESSAGE_TTL_MS });
      return { ok: true, result: { id } };
    }
    case 'read': {
      const queue = queues.get(op.queueId);
      if (!queue || queue.rcvKey !== op.queueKey) return { ok: true, result: [] };
      evict(queue);
      return { ok: true, result: queue.messages.slice(0, op.limit ?? 100) };
    }
    case 'ack': {
      const queue = queues.get(op.queueId);
      if (!queue || queue.rcvKey !== op.queueKey) return { ok: true, result: 0 };
      const before = queue.messages.length;
      const ids = Array.isArray(op.ids) ? op.ids : [];
      queue.messages = queue.messages.filter(m => !ids.includes(m.id));
      return { ok: true, result: before - queue.messages.length };
    }
    case 'delete': {
      const queue = queues.get(op.queueId);
      if (!queue || queue.rcvKey !== op.queueKey) return { ok: true, result: false };
      queues.delete(op.queueId);
      return { ok: true, result: true };
    }
    default:
      return { ok: false, error: 'unknown-op' };
  }
}

const wss = new WebSocketServer({ host: HOST, port: PORT });
wss.on('listening', () => {
  console.log(`[relay] listening on ws://${HOST}:${PORT} (${queues.size} queues)`);
});
wss.on('connection', socket => {
  socket.on('message', data => {
    let frame;
    try {
      frame = JSON.parse(String(data));
    } catch {
      return;
    }
    socket.send(JSON.stringify({ id: frame.id, response: handle(frame.op) }));
  });
});
