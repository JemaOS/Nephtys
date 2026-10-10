// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { RelayCore } from './relayCore';
import { LocalWire } from './wire';
import { RelayTransport, encodeInvite, decodeInvite } from './relayTransport';

function withTimeout<T>(p: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_res, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

describe('RelayTransport (phase 2 — transport relais, sans graphe)', () => {
  it('encode/décode une invitation (hors-bande) à l\'identique', () => {
    const invite = {
      rcvQueue: { queueId: 'q-in', queueKey: 'k-in' },
      sendQueue: { queueId: 'q-out', queueKey: 'k-out' },
    };
    const link = encodeInvite(invite);
    expect(link).not.toContain('+');
    expect(link).not.toContain('/');
    expect(decodeInvite(link)).toEqual(invite);
  });

  it('livre le ciphertext d\'Alice à Bob via le relais (files opaques)', async () => {
    const core = new RelayCore();
    const wire = new LocalWire(core);
    const alice = new RelayTransport(wire, 10);
    const bob = new RelayTransport(wire, 10);

    const { connection, invite } = await alice.createConnection();
    alice.registerConnection('conv', connection);
    bob.acceptInvite('conv', invite);

    const received = new Promise<string>(resolve => {
      bob.subscribe('conv', m => resolve(m.content));
    });

    await alice.sendMessage({
      conversationId: 'conv',
      senderId: 'alice',
      content: 'CIPHERTEXT-OPAQUE',
      type: 'text',
    });

    expect(await withTimeout(received)).toBe('CIPHERTEXT-OPAQUE');
  });

  it('rotation de file : la nouvelle file de réception est interrogée', async () => {
    const core = new RelayCore();
    const wire = new LocalWire(core);
    const alice = new RelayTransport(wire, 10);

    const { connection } = await alice.createConnection();
    alice.registerConnection('c', connection);
    expect(alice.connectionFor('c')?.rcvQueue.queueId).toBe(connection.rcvQueue.queueId);

    const { ourRcv, peerRef } = await alice.createReceiveQueue();
    alice.addReceiveQueue('c', ourRcv);

    // La file courante est désormais la nouvelle (dernière ajoutée)…
    expect(alice.connectionFor('c')?.rcvQueue.queueId).toBe(ourRcv.queueId);
    // …et le pair dispose d'une référence d'écriture distincte (sendKey).
    expect(peerRef.queueId).toBe(ourRcv.queueId);
    expect(peerRef.queueKey).not.toBe(ourRcv.queueKey);
  });

  it('sendMessage échoue proprement sans connexion enregistrée', async () => {
    const core = new RelayCore();
    const wire = new LocalWire(core);
    const t = new RelayTransport(wire, 10);
    await expect(
      t.sendMessage({ conversationId: 'inconnu', senderId: 'x', content: 'y', type: 'text' }),
    ).rejects.toBeTruthy();
  });
});
