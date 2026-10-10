// E2E : le serveur browser-profile + deux clients SMP navigateur via VRAI WebSocket.
import { startServer } from './index.mjs';
import * as smp from './lib/browser-smp-core.mjs';
import { createBrowserSimplexClient } from './lib/browser-simplex-client.mjs';
import { createBrowserSimplexContactClient } from './lib/browser-simplex-contact-client.mjs';
import { createBrowserSimplexStore } from './lib/browser-simplex-store.mjs';
import { connectBrowserSmpWebSocketTransport } from './lib/browser-smp-websocket-transport.mjs';

function filled(length, value) { return new Uint8Array(length).fill(value); }

const PORT = Number(process.env.PORT || 8791);
if (!process.env.SMP_URL) {
  startServer({ port: PORT, host: '127.0.0.1' });
}
const url = process.env.SMP_URL || `ws://127.0.0.1:${PORT}/`;

async function makeClient(name) {
  const transport = await connectBrowserSmpWebSocketTransport({ url });
  return { transport, client: createBrowserSimplexClient({ transport }) };
}

async function main() {
  const alice = await makeClient('alice');
  const bob = await makeClient('bob');
  console.log('[e2e] clients connected (version', alice.transport.version, ')');

  const aliceStore = createBrowserSimplexStore({ namespace: 'ws-e2e-alice' });
  const bobStore = createBrowserSimplexStore({ namespace: 'ws-e2e-bob' });
  const aliceContacts = createBrowserSimplexContactClient({ client: alice.client, store: aliceStore });
  const bobContacts = createBrowserSimplexContactClient({ client: bob.client, store: bobStore });

  await aliceContacts.createInvitation({ id: 'bob', corrId: 'alice-new', rcvSignSeed: filled(32, 1), rcvDhSeed: filled(32, 2) });
  await bobContacts.createInvitation({ id: 'alice', corrId: 'bob-new', rcvSignSeed: filled(32, 3), rcvDhSeed: filled(32, 4) });

  const aliceInbox = aliceStore.loadQueue('bob:inbox');
  const bobInbox = bobStore.loadQueue('alice:inbox');
  const aliceSenderSign = smp.generateEd25519KeyPair(filled(32, 5));
  const bobSenderSign = smp.generateEd25519KeyPair(filled(32, 6));
  await alice.client.secureQueue(aliceInbox, bobSenderSign.publicKeyDer, { corrId: 'alice-key' });
  await bob.client.secureQueue(bobInbox, aliceSenderSign.publicKeyDer, { corrId: 'bob-key' });

  const aliceDh = smp.generateX25519KeyPair(filled(32, 7));
  const bobDh = smp.generateX25519KeyPair(filled(32, 8));
  const rootKey = filled(32, 9);
  aliceContacts.activateContact('bob', { rootKey, ownDhKey: aliceDh, remoteDhPublicKey: bobDh.publicKey, outboundQueue: { sndId: bobInbox.sndId, senderSignKey: aliceSenderSign } });
  bobContacts.activateContact('alice', { rootKey, ownDhKey: bobDh, initializeSending: false, outboundQueue: { sndId: aliceInbox.sndId, senderSignKey: bobSenderSign } });

  await aliceContacts.sendText('bob', 'hello bob (via WS)', { corrId: 'alice-send-1' });
  const bobReceived = await bobContacts.receiveNext('alice', { ackCorrId: 'bob-ack-1' });
  console.log('[e2e] Bob a reçu :', JSON.stringify(bobReceived.text));

  await bobContacts.sendText('alice', 'hello alice (via WS)', { corrId: 'bob-send-1' });
  const aliceReceived = await aliceContacts.receiveNext('bob', { ackCorrId: 'alice-ack-1' });
  console.log('[e2e] Alice a reçu :', JSON.stringify(aliceReceived.text));

  if (bobReceived.text !== 'hello bob (via WS)' || aliceReceived.text !== 'hello alice (via WS)') {
    throw new Error('E2E FAILED: messages mismatch');
  }
  console.log('[e2e] ✅ SUCCESS — navigateur (WS) <-> serveur browser-profile : E2E OK');
  process.exit(0);
}

main().catch((e) => { console.error('[e2e] ❌ FAILED:', e && e.message); process.exit(1); });
