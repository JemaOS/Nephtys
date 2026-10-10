import { describe, it, expect } from 'vitest';
import { RelayCore } from './relayCore';
import { LocalWire, type RelayOp, type RelayResponse, type RelayWire } from './wire';
import { PrivateMessenger, COVER_MARKER } from './privateMessenger';
import { InMemoryConnectionStore } from './connectionStore';
import { InMemoryHistoryStore } from './historyStore';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Wire espion : capture le ciphertext déposé dans le relais. */
class SpyWire implements RelayWire {
  readonly sends: string[] = [];
  constructor(private readonly inner: RelayWire) {}
  async request(op: RelayOp): Promise<RelayResponse> {
    if (op.op === 'send') this.sends.push(op.ciphertext);
    return this.inner.request(op);
  }
}

describe('PrivateMessenger (mode anonyme, hors Supabase)', () => {
  it('establishes via an out-of-band link and exchanges E2EE messages over the relay', async () => {
    const core = new RelayCore();
    const alice = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5);
    const bob = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5);

    const { link } = await alice.establish('c1');
    await bob.accept('c1', link);

    const atAlice: string[] = [];
    const atBob: string[] = [];
    const unsubA = alice.subscribe('c1', t => atAlice.push(t));
    const unsubB = bob.subscribe('c1', t => atBob.push(t));

    await bob.send('c1', 'salut alice'); // Bob initiateur
    await wait(250);
    expect(atAlice).toEqual(['salut alice']);

    await alice.send('c1', 'salut bob'); // Alice répond (ratchet DH)
    await wait(250);
    expect(atBob).toEqual(['salut bob']);

    unsubA();
    unsubB();
  });

  it('delivers out-of-order messages over the relay', async () => {
    const core = new RelayCore();
    const alice = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 10);
    const bob = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 10);
    const { link } = await alice.establish('c2');
    await bob.accept('c2', link);

    const atAlice: string[] = [];
    const unsub = alice.subscribe('c2', t => atAlice.push(t));

    await bob.send('c2', 'm1');
    await wait(30);
    await bob.send('c2', 'm2');
    await bob.send('c2', 'm3');
    await wait(80);

    expect(new Set(atAlice)).toEqual(new Set(['m1', 'm2', 'm3']));
    unsub();
  });

  it('never exposes plaintext to the relay (opaque ciphertext only)', async () => {
    const core = new RelayCore();
    const spy = new SpyWire(new LocalWire(core));
    const alice = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 10);
    const bob = new PrivateMessenger(spy, new InMemoryConnectionStore(), 10);

    const { link } = await alice.establish('c3');
    await bob.accept('c3', link);
    await bob.send('c3', 'TOP-SECRET');

    expect(spy.sends).toHaveLength(1);
    expect(spy.sends[0]).not.toContain('TOP-SECRET');
    // Le blob est du base64 décodable en JSON opaque {header, iv, ct, init}.
    const decoded = JSON.parse(Buffer.from(spy.sends[0], 'base64').toString('utf8'));
    expect(decoded).toHaveProperty('ct');
    expect(decoded).toHaveProperty('header');
  });

  it('refuses to send before a connection is established', async () => {
    const messenger = new PrivateMessenger(new LocalWire(new RelayCore()), new InMemoryConnectionStore());
    await expect(messenger.send('unknown', 'x')).rejects.toThrow(/session absente/);
  });

  it('persists local history and never surfaces cover traffic', async () => {
    const core = new RelayCore();
    const aliceHistory = new InMemoryHistoryStore();
    const bobHistory = new InMemoryHistoryStore();
    const alice = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5, aliceHistory);
    const bob = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5, bobHistory);
    const { link } = await alice.establish('c4');
    await bob.accept('c4', link);

    const atAlice: string[] = [];
    const unsub = alice.subscribe('c4', t => atAlice.push(t));

    await bob.send('c4', 'bonjour');
    await wait(150);
    expect(atAlice).toEqual(['bonjour']);

    // Historique local persistant des deux côtés.
    expect((await bob.history('c4')).map(m => m.text)).toContain('bonjour');
    expect((await alice.history('c4')).map(m => m.text)).toContain('bonjour');

    // Trafic de couverture : émis mais jamais affiché ni persisté.
    const stop = bob.startCoverTraffic('c4', 10);
    await wait(60);
    stop();
    await wait(60);

    expect(atAlice).not.toContain(COVER_MARKER);
    expect((await alice.history('c4')).map(m => m.text)).not.toContain(COVER_MARKER);
    expect((await bob.history('c4')).map(m => m.text)).not.toContain(COVER_MARKER);
    unsub();
  });

  it('rotates the receive queue and keeps delivering messages', async () => {
    const core = new RelayCore();
    const alice = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5);
    const bob = new PrivateMessenger(new LocalWire(core), new InMemoryConnectionStore(), 5);
    const { link } = await alice.establish('c5');
    await bob.accept('c5', link);

    const atAlice: string[] = [];
    const unsubA = alice.subscribe('c5', t => atAlice.push(t));
    const unsubB = bob.subscribe('c5', () => {}); // Bob doit lire pour traiter le contrôle

    await bob.send('c5', 'avant');
    await wait(120);
    expect(atAlice).toContain('avant');

    // Alice fait tourner sa file de réception (annonce chiffrée à Bob).
    await alice.rotateQueue('c5', 1000);
    await wait(80);

    await bob.send('c5', 'apres');
    await wait(150);
    expect(atAlice).toContain('apres');

    unsubA();
    unsubB();
  });
});
