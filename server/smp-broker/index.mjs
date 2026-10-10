// SMP browser-profile broker — WebSocket server (Node).
// Implémente le profil serveur attendu par simplex-web (client SMP navigateur).
// Base extraite de tests/browser-simplex-e2e-broker.test.mjs (AGPL-3), enveloppée
// en WebSocket + durcie « prod » : persistance disque, limites, re-souscription.
//
// Un bloc SMP paddé par frame WebSocket. Handshake : serveur -> handshake, puis
// client -> handshake, puis transmissions.
//
// Les corps des messages restent chiffrés bout-en-bout par les clients ; le
// relais ne voit que des blocs opaques (pas de clair, pas de graphe).

import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as smp from './lib/browser-smp-core.mjs';
import { encryptRcvMessageBody } from './lib/browser-simplex-agent.mjs';

const SMP_VERSION = 4; // version négociée (profil navigateur v4)
const SUBPROTOCOL = 'simplex-smp.v4.ws';

// Limites « prod »
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 262144); // 256 Ko / message
const MAX_QUEUES = Number(process.env.MAX_QUEUES || 100000);
const MAX_MSGS_PER_QUEUE = Number(process.env.MAX_MSGS_PER_QUEUE || 5000);

function filled(length, value) {
  return new Uint8Array(length).fill(value);
}

function idBytes(prefix, value) {
  const out = new Uint8Array(24);
  out.set(smp.asciiBytes(prefix + '-' + value).slice(0, 24));
  return out;
}

class BrowserProfileBroker {
  constructor(storePath) {
    this.version = SMP_VERSION;
    this.sessionId = filled(32, 90);
    this.nextQueue = 1;
    this.nextMessage = 1;
    this.queues = new Map();
    this.storePath = storePath;
    this.saveTimer = null;
    this.load();
  }

  // ─── Persistance ────────────────────────────────────────────────────
  load() {
    if (!this.storePath) return;
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      this.nextQueue = raw.nextQueue || 1;
      this.nextMessage = raw.nextMessage || 1;
      for (const [key, q] of Object.entries(raw.queues || {})) {
        const queue = {
          rcvId: smp.decodeBase64Url(q.rcvId),
          sndId: smp.decodeBase64Url(q.sndId),
          rcvPublicVerifyKey: smp.decodeBase64Url(q.rcvPublicVerifyKey),
          serverDhSecret: smp.decodeBase64Url(q.serverDhSecret),
          senderVerifyKey: q.senderVerifyKey ? smp.decodeBase64Url(q.senderVerifyKey) : null,
          recipientTransport: null,
          messages: new Map(
            Object.entries(q.messages || {}).map(([mk, m]) => [
              mk,
              { msgId: smp.decodeBase64Url(m.msgId), acked: !!m.acked, delivered: !!m.delivered, body: m.body ? smp.decodeBase64Url(m.body) : new Uint8Array() },
            ]),
          ),
        };
        this.queues.set(key, queue);
      }
      console.log(`[smp-broker] restored ${this.queues.size} queues from ${this.storePath}`);
    } catch (e) {
      console.error('[smp-broker] load failed:', e && e.message);
    }
  }

  scheduleSave() {
    if (!this.storePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 200);
  }

  save() {
    if (!this.storePath) return;
    try {
      const queues = {};
      for (const [key, q] of this.queues.entries()) {
        queues[key] = {
          rcvId: smp.encodeBase64Url(q.rcvId),
          sndId: smp.encodeBase64Url(q.sndId),
          rcvPublicVerifyKey: smp.encodeBase64Url(q.rcvPublicVerifyKey),
          serverDhSecret: smp.encodeBase64Url(q.serverDhSecret),
          senderVerifyKey: q.senderVerifyKey ? smp.encodeBase64Url(q.senderVerifyKey) : null,
          messages: Object.fromEntries(
            Array.from(q.messages.entries()).map(([mk, m]) => [
              mk,
              { msgId: smp.encodeBase64Url(m.msgId), acked: !!m.acked, delivered: !!m.delivered, body: smp.encodeBase64Url(m.body || new Uint8Array()) },
            ]),
          ),
        };
      }
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({ nextQueue: this.nextQueue, nextMessage: this.nextMessage, queues }));
    } catch (e) {
      console.error('[smp-broker] save failed:', e && e.message);
    }
  }

  // ─── Traitement SMP ─────────────────────────────────────────────────
  enqueueError(transport, parsed, commandError = 'AUTH') {
    transport.enqueue({ corrId: parsed.corrId, queueId: parsed.queueId, message: { type: 'ERR', error: { type: 'CMD', commandError } } });
  }

  verify(parsed, publicKeyDer) {
    return parsed.signature.length > 0 && smp.ed25519Verify(publicKeyDer, parsed.signed, parsed.signature);
  }

  findByRecipientId(queueId) {
    return this.queues.get(smp.encodeBase64Url(queueId)) || null;
  }

  findBySenderId(queueId) {
    for (const queue of this.queues.values()) {
      if (smp.equalBytes(queue.sndId, queueId)) return queue;
    }
    return null;
  }

  process(transport, transmission) {
    const parsed = transmission && transmission.command && transmission.corrId
      ? transmission
      : smp.parseSignedTransmission(this.version, transmission.bytes || transmission);
    const command = parsed.command;
    if (command.type === 'NEW') return this.newQueue(transport, parsed, command);
    if (command.type === 'SEND') return this.sendMessage(transport, parsed, command);
    const queue = this.findByRecipientId(parsed.queueId);
    if (!queue || !this.verify(parsed, queue.rcvPublicVerifyKey)) return this.enqueueError(transport, parsed);
    if (command.type === 'SUB') return this.subscribe(transport, parsed, queue);
    if (command.type === 'KEY') {
      queue.senderVerifyKey = command.sndPublicVerifyKey;
      this.scheduleSave();
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    if (command.type === 'ACK') {
      const key = smp.encodeBase64Url(command.msgId);
      const queued = queue.messages.get(key);
      if (queued) queued.acked = true;
      this.scheduleSave();
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    if (command.type === 'DEL') {
      this.queues.delete(smp.encodeBase64Url(queue.rcvId));
      this.scheduleSave();
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    return this.enqueueError(transport, parsed, 'SYNTAX');
  }

  newQueue(transport, parsed, command) {
    if (!this.verify(parsed, command.rcvPublicVerifyKey)) return this.enqueueError(transport, parsed);
    if (this.queues.size >= MAX_QUEUES) return this.enqueueError(transport, parsed, 'QUOTA');
    const n = this.nextQueue++;
    const serverDh = smp.generateX25519KeyPair(crypto.getRandomValues(new Uint8Array(32)));
    const recipientDh = smp.decodePublicKeyDer(command.rcvPublicDhKey);
    const rcvId = idBytes('rcv', n);
    const sndId = idBytes('snd', n);
    const queue = {
      rcvId,
      sndId,
      rcvPublicVerifyKey: command.rcvPublicVerifyKey,
      serverDhSecret: smp.x25519SharedSecret(serverDh.secretKey, recipientDh.rawPublicKey),
      senderVerifyKey: null,
      recipientTransport: transport,
      messages: new Map(),
    };
    this.queues.set(smp.encodeBase64Url(rcvId), queue);
    this.scheduleSave();
    transport.enqueue({ corrId: parsed.corrId, queueId: rcvId, message: { type: 'IDS', rcvId, sndId, rcvPublicDhKey: serverDh.publicKeyDer } });
  }

  /** Re-souscription : (re)lie le transport destinataire et livre les messages en attente. */
  subscribe(transport, parsed, queue) {
    queue.recipientTransport = transport;
    for (const m of queue.messages.values()) {
      if (m.acked || m.delivered) continue;
      transport.enqueue({ corrId: smp.asciiBytes('redeliver'), queueId: queue.rcvId, message: { type: 'MSG', msgId: m.msgId, body: m.body } });
      m.delivered = true;
    }
    this.scheduleSave();
    return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
  }

  sendMessage(transport, parsed, command) {
    const queue = this.findBySenderId(parsed.queueId);
    if (!queue) return this.enqueueError(transport, parsed, 'NO_QUEUE');
    if (queue.senderVerifyKey && !this.verify(parsed, queue.senderVerifyKey)) return this.enqueueError(transport, parsed);
    const bodyLen = command.body ? command.body.length : 0;
    if (bodyLen > MAX_BODY_BYTES) return this.enqueueError(transport, parsed, 'QUOTA');
    if (queue.messages.size >= MAX_MSGS_PER_QUEUE) {
      // Purge des messages acquittés les plus anciens avant de refuser.
      for (const [k, m] of queue.messages) {
        if (m.acked) queue.messages.delete(k);
        if (queue.messages.size < MAX_MSGS_PER_QUEUE) break;
      }
      if (queue.messages.size >= MAX_MSGS_PER_QUEUE) return this.enqueueError(transport, parsed, 'QUOTA');
    }
    const msgId = idBytes('msg', this.nextMessage++);
    const encryptedBody = encryptRcvMessageBody({
      serverDhSecret: queue.serverDhSecret,
      msgId,
      timestamp: BigInt(this.nextMessage),
      flags: command.flags,
      body: command.body,
    });
    const entry = { msgId, acked: false, delivered: false, body: encryptedBody };
    queue.messages.set(smp.encodeBase64Url(msgId), entry);
    if (queue.recipientTransport) {
      queue.recipientTransport.enqueue({ corrId: smp.asciiBytes('msg-' + this.nextMessage), queueId: queue.rcvId, message: { type: 'MSG', msgId, body: encryptedBody } });
      entry.delivered = true;
    }
    this.scheduleSave();
    transport.enqueue({ corrId: parsed.corrId, queueId: queue.sndId, message: { type: 'OK' } });
  }
}

/** Transport d'une connexion : sérialise les messages broker sur le WebSocket. */
class WsTransport {
  constructor(broker, socket, version, sessionId) {
    this.broker = broker;
    this.socket = socket;
    this.version = version;
    this.sessionId = sessionId;
  }

  enqueue(brokerMsg) {
    const stx = smp.encodeSignedTransmission(this.version, this.sessionId, {
      corrId: brokerMsg.corrId,
      queueId: brokerMsg.queueId,
      commandBytes: smp.encodeBrokerMessage(this.version, brokerMsg.message),
    });
    const block = smp.encodeTransportBlock(this.version, [{ bytes: stx.bytes }]);
    try { this.socket.send(block); } catch { /* socket closed */ }
  }

  onBlock(block) {
    const transmissions = smp.decodeTransportBlock(this.version, block, { sessionId: this.sessionId });
    for (const tx of transmissions) this.broker.process(this, tx);
  }
}

export function startServer({ port = 8765, host = '0.0.0.0', storePath = process.env.STORE_PATH || '' } = {}) {
  const broker = new BrowserProfileBroker(storePath);
  const wss = new WebSocketServer({
    port,
    host,
    handleProtocols: (protocols) => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
  });
  wss.on('connection', (socket) => {
    const sessionId = crypto.getRandomValues(new Uint8Array(32));
    socket.send(smp.padBlock(smp.encodeServerHandshake({ minVersion: SMP_VERSION, maxVersion: SMP_VERSION, sessionId })));
    const transport = new WsTransport(broker, socket, SMP_VERSION, sessionId);
    let handshaken = false;
    socket.on('message', (data) => {
      const block = new Uint8Array(data);
      try {
        if (!handshaken) {
          const ch = smp.parseClientHandshake(smp.unpadBlock(block));
          transport.version = ch.version;
          handshaken = true;
          return;
        }
        transport.onBlock(block);
      } catch (e) {
        console.error('[smp-broker] block error:', e && e.message);
      }
    });
    socket.on('error', () => {});
  });
  console.log(`[smp-broker] browser-profile SMP broker on ws://${host}:${port} (store=${storePath || 'memory'})`);
  return wss;
}

// Démarrage direct : `node index.mjs`
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  startServer({ port: Number(process.env.PORT || 8765), storePath: process.env.STORE_PATH || '' });
}
