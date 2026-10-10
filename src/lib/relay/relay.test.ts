import { describe, it, expect } from 'vitest';
import { RelayCore } from './relayCore';
import { LocalWire } from './wire';
import { RelayTransport, encodeInvite, decodeInvite } from './relayTransport';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('RelayCore', () => {
  it('stores only opaque ciphertext and enforces per-direction keys', () => {
    const core = new RelayCore();
    const queue = core.createQueue();

    // Mauvaise clé d'envoi → refusé ; mauvaise clé de lecture → vide.
    expect(core.send(queue.queueId, 'wrong-key', 'x')).toBeNull();
    expect(core.read(queue.queueId, 'wrong-key')).toEqual([]);

    const sent = core.send(queue.queueId, queue.sendKey, 'cipher-blob');
    expect(sent?.id).toBeTruthy();

    const messages = core.read(queue.queueId, queue.rcvKey);
    expect(messages).toHaveLength(1);
    expect(messages[0].ciphertext).toBe('cipher-blob');

    // Aucune identité n'est stockée : uniquement ciphertext/id/timestamps.
    expect(Object.keys(messages[0]).sort()).toEqual(['ciphertext', 'expiresAt', 'id', 'ts']);

    // Lecture sans ack → toujours présent ; puis ack le retire.
    expect(core.read(queue.queueId, queue.rcvKey)).toHaveLength(1);
    expect(core.ack(queue.queueId, queue.rcvKey, [messages[0].id])).toBe(1);
    expect(core.read(queue.queueId, queue.rcvKey)).toHaveLength(0);

    // Suppression de file protégée par la clé de réception.
    expect(core.deleteQueue(queue.queueId, 'wrong')).toBe(false);
    expect(core.deleteQueue(queue.queueId, queue.rcvKey)).toBe(true);
  });
});

describe('RelayTransport (identifiant-less, self-hosted relay)', () => {
  it('delivers messages both ways without the server seeing identities', async () => {
    const core = new RelayCore();
    const alice = new RelayTransport(new LocalWire(core), 10);
    const bob = new RelayTransport(new LocalWire(core), 10);

    const { connection, invite } = await alice.createConnection();
    alice.registerConnection('alice->bob', connection);
    bob.acceptInvite('bob->alice', invite);

    const atBob: any[] = [];
    const unsubscribeBob = bob.subscribe('bob->alice', m => atBob.push(m));

    await alice.sendMessage({ conversationId: 'alice->bob', senderId: 'alice', content: 'cipher-1', type: 'text' });
    await wait(60);

    expect(atBob).toHaveLength(1);
    expect(atBob[0].content).toBe('cipher-1');
    // Le relais n'a aucune notion d'expéditeur.
    expect(atBob[0].raw).not.toHaveProperty('senderId');

    const atAlice: any[] = [];
    const unsubscribeAlice = alice.subscribe('alice->bob', m => atAlice.push(m));

    await bob.sendMessage({ conversationId: 'bob->alice', senderId: 'bob', content: 'cipher-2', type: 'text' });
    await wait(60);
    expect(atAlice.map(m => m.content)).toContain('cipher-2');

    unsubscribeBob();
    unsubscribeAlice();

    // Deux files seulement (une par direction), aucun identifiant utilisateur.
    expect(core.queueCount).toBe(2);
  });

  it('round-trips invitations', async () => {
    const core = new RelayCore();
    const alice = new RelayTransport(new LocalWire(core));
    const { invite } = await alice.createConnection();
    const decoded = decodeInvite(invite);
    expect(decodeInvite(encodeInvite(decoded))).toEqual(decoded);
  });

  it('refuses to send without a registered connection', async () => {
    const transport = new RelayTransport(new LocalWire(new RelayCore()));
    await expect(
      transport.sendMessage({ conversationId: 'nope', senderId: 'x', content: 'y', type: 'text' }),
    ).rejects.toThrow(/connexion/);
  });
});
