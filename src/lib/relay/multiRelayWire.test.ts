import { describe, it, expect } from 'vitest';
import { MultiRelayWire } from './multiRelayWire';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

class FakeWire implements RelayWire {
  calls: RelayOp[] = [];
  constructor(private readonly url: string, private readonly failCreate = false) {}
  async request(op: RelayOp): Promise<RelayResponse> {
    this.calls.push(op);
    if (op.op === 'createQueue') {
      if (this.failCreate) throw new Error('down');
      return {
        ok: true,
        result: { queueId: `${this.url}q${this.calls.length}`, sendKey: 's', rcvKey: 'r' },
      };
    }
    return { ok: true, result: { id: 'x' } };
  }
}

describe('MultiRelayWire (réseau décentralisé)', () => {
  it('répartit les files en round-robin et tague le relais hôte', async () => {
    const a = new FakeWire('wss://a/');
    const b = new FakeWire('wss://b/');
    const m = new MultiRelayWire([
      { url: 'wss://a/', wire: a },
      { url: 'wss://b/', wire: b },
    ]);
    const c1 = (await m.request({ op: 'createQueue' })).result as { relay?: string };
    const c2 = (await m.request({ op: 'createQueue' })).result as { relay?: string };
    expect(c1.relay).toBe('wss://a/');
    expect(c2.relay).toBe('wss://b/');
  });

  it('route les opérations vers le relais qui héberge la file', async () => {
    const a = new FakeWire('wss://a/');
    const b = new FakeWire('wss://b/');
    const m = new MultiRelayWire([
      { url: 'wss://a/', wire: a },
      { url: 'wss://b/', wire: b },
    ]);
    await m.request({ op: 'send', queueId: 'q', queueKey: 'k', ciphertext: 'c', relay: 'wss://b/' });
    expect(b.calls.length).toBe(1);
    expect(a.calls.length).toBe(0);
  });

  it('essaie le relais suivant si le premier échoue à la création', async () => {
    const a = new FakeWire('wss://a/', true);
    const b = new FakeWire('wss://b/');
    const m = new MultiRelayWire([
      { url: 'wss://a/', wire: a },
      { url: 'wss://b/', wire: b },
    ]);
    const c = (await m.request({ op: 'createQueue' })).result as { relay?: string };
    expect(c.relay).toBe('wss://b/');
  });
});
