// SMP browser-profile broker — WebSocket server (Node).
// Implémente le profil serveur attendu par simplex-web (client SMP navigateur).
// Extrait de tests/browser-simplex-e2e-broker.test.mjs (AGPL-3), enveloppé en WS.
//
// Un bloc SMP paddé par frame WebSocket. Handshake : serveur -> handshake, puis
// client -> handshake, puis transmissions.
//
// ⚠️ Expérimental : démonstration/relais perso. Pas d'audit. Les corps des
// messages restent chiffrés bout-en-bout par les clients ; le relais ne voit
// que des blocs opaques.

import { WebSocketServer } from 'ws';
import crypto from 'node:crypto';
import * as smp from './lib/browser-smp-core.mjs';
import { encryptRcvMessageBody } from './lib/browser-simplex-agent.mjs';

const SMP_VERSION = 4; // version négociée (profil navigateur v4)
const SUBPROTOCOL = 'simplex-smp.v4.ws';

function filled(length, value) {
  return new Uint8Array(length).fill(value);
}

function idBytes(prefix, value) {
  const out = new Uint8Array(24);
  out.set(smp.asciiBytes(prefix + '-' + value).slice(0, 24));
  return out;
}

class BrowserProfileBroker {
  constructor() {
    this.version = SMP_VERSION;
    this.sessionId = filled(32, 90);
    this.nextQueue = 1;
    this.nextMessage = 1;
    this.queues = new Map();
  }

  enqueueError(transport, parsed, commandError = 'AUTH') {
    transport.enqueue({
      corrId: parsed.corrId,
      queueId: parsed.queueId,
      message: { type: 'ERR', error: { type: 'CMD', commandError } },
    });
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
    if (command.type === 'SUB') return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    if (command.type === 'KEY') {
      queue.senderVerifyKey = command.sndPublicVerifyKey;
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    if (command.type === 'ACK') {
      const key = smp.encodeBase64Url(command.msgId);
      const queued = queue.messages.get(key);
      if (queued) queued.acked = true;
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    if (command.type === 'DEL') {
      this.queues.delete(smp.encodeBase64Url(queue.rcvId));
      return transport.enqueue({ corrId: parsed.corrId, queueId: queue.rcvId, message: { type: 'OK' } });
    }
    return this.enqueueError(transport, parsed, 'SYNTAX');
  }

  newQueue(transport, parsed, command) {
    if (!this.verify(parsed, command.rcvPublicVerifyKey)) return this.enqueueError(transport, parsed);
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
    transport.enqueue({
      corrId: parsed.corrId,
      queueId: rcvId,
      message: { type: 'IDS', rcvId, sndId, rcvPublicDhKey: serverDh.publicKeyDer },
    });
  }

  sendMessage(transport, parsed, command) {
    const queue = this.findBySenderId(parsed.queueId);
    if (!queue) return this.enqueueError(transport, parsed, 'NO_QUEUE');
    if (queue.senderVerifyKey && !this.verify(parsed, queue.senderVerifyKey)) return this.enqueueError(transport, parsed);
    const msgId = idBytes('msg', this.nextMessage++);
    const encryptedBody = encryptRcvMessageBody({
      serverDhSecret: queue.serverDhSecret,
      msgId,
      timestamp: BigInt(this.nextMessage),
      flags: command.flags,
      body: command.body,
    });
    queue.messages.set(smp.encodeBase64Url(msgId), { msgId, acked: false });
    queue.recipientTransport.enqueue({
      corrId: smp.asciiBytes('msg-' + this.nextMessage),
      queueId: queue.rcvId,
      message: { type: 'MSG', msgId, body: encryptedBody },
    });
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
    this.socket.send(block);
  }

  onBlock(block) {
    const transmissions = smp.decodeTransportBlock(this.version, block, { sessionId: this.sessionId });
    for (const tx of transmissions) this.broker.process(this, tx);
  }
}

export function startServer({ port = 8765, host = '0.0.0.0' } = {}) {
  const broker = new BrowserProfileBroker();
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
  console.log(`[smp-broker] browser-profile SMP broker on ws://${host}:${port} (subprotocol ${SUBPROTOCOL})`);
  return wss;
}

// Démarrage direct : `node index.mjs`
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  startServer({ port: Number(process.env.PORT || 8765) });
}
