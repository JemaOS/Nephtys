// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FailoverRelayWire } from './failoverRelayWire';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

const PRIMARY = 'wss://smp.example/';
const SECONDARY = 'supabase';

class FakeWire implements RelayWire {
  calls: RelayOp[] = [];
  failCreate = false;
  readonly relayIds: string[];
  constructor(readonly id: string) {
    this.relayIds = [id];
  }
  async request(op: RelayOp): Promise<RelayResponse> {
    this.calls.push(op);
    if (op.op === 'createQueue') {
      if (this.failCreate) throw new Error('down');
      return {
        ok: true,
        result: { queueId: `${this.id}#${this.calls.length}`, sendKey: 's', rcvKey: 'r', relay: this.id },
      };
    }
    return { ok: true, result: { id: 'x' } };
  }
  sends(): RelayOp[] {
    return this.calls.filter(c => c.op === 'send');
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FailoverRelayWire (repli temporaire, routage par file)', () => {
  it('tague la file créée avec le relais hôte et route les ops par ce tag', async () => {
    const primary = new FakeWire(PRIMARY);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary);

    const created = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(created.relay).toBe(PRIMARY);

    await fw.request({ op: 'send', queueId: 'q', queueKey: 'k', ciphertext: 'c', relay: PRIMARY });
    expect(primary.sends()).toHaveLength(1);
    expect(secondary.sends()).toHaveLength(0);

    await fw.request({ op: 'send', queueId: 'q', queueKey: 'k', ciphertext: 'c', relay: SECONDARY });
    expect(secondary.sends()).toHaveLength(1);
    expect(primary.sends()).toHaveLength(1);
  });

  it('ne bascule qu’à la création : une file du primaire reste routée vers le primaire même en repli', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const states: boolean[] = [];
    const primary = new FakeWire(PRIMARY);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary, a => states.push(a));

    // 1) file créée sur le primaire (avant panne).
    const p = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(p.relay).toBe(PRIMARY);

    // 2) le primaire tombe → la NOUVELLE file part en repli.
    primary.failCreate = true;
    const s = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(s.relay).toBe(SECONDARY);
    expect(fw.onFallback).toBe(true);

    // 3) les ops de la file du primaire vont TOUJOURS au primaire (pas de split-brain).
    await fw.request({ op: 'read', queueId: 'qp', queueKey: 'k', relay: PRIMARY });
    expect(primary.calls.filter(c => c.op === 'read')).toHaveLength(1);
    expect(secondary.calls.filter(c => c.op === 'read')).toHaveLength(0);

    // 4) et la file créée en repli est routée vers le secondaire.
    await fw.request({ op: 'read', queueId: 'qs', queueKey: 'k', relay: SECONDARY });
    expect(secondary.calls.filter(c => c.op === 'read')).toHaveLength(1);

    expect(states).toEqual([true]);
  });

  it('une file créée en repli reste accessible après le retour du primaire', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const states: boolean[] = [];
    const primary = new FakeWire(PRIMARY);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary, a => states.push(a));

    primary.failCreate = true;
    const s = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(s.relay).toBe(SECONDARY);
    expect(fw.onFallback).toBe(true);

    // Le primaire remonte + cooldown écoulé → la prochaine création repart au primaire.
    primary.failCreate = false;
    vi.setSystemTime(new Date('2026-01-01T00:00:31Z'));
    const p = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(p.relay).toBe(PRIMARY);
    expect(fw.onFallback).toBe(false);

    // La file hébergée en repli reste joignable sur le secondaire.
    await fw.request({ op: 'send', queueId: 'qs', queueKey: 'k', ciphertext: 'c', relay: SECONDARY });
    expect(secondary.sends()).toHaveLength(1);

    expect(states).toEqual([true, false]);
  });

  it('renvoie une erreur explicite pour un relais hors pool', async () => {
    const primary = new FakeWire(PRIMARY);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary);

    const resp = await fw.request({
      op: 'send',
      queueId: 'q',
      queueKey: 'k',
      ciphertext: 'c',
      relay: 'wss://inconnu/',
    });
    expect(resp.ok).toBe(false);
    expect(resp.error).toMatch(/inconnu/);
    expect(primary.calls).toHaveLength(0);
    expect(secondary.calls).toHaveLength(0);
  });

  it('route une file sans tag vers le primaire (rétro-compatibilité)', async () => {
    const primary = new FakeWire(PRIMARY);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary);

    await fw.request({ op: 'send', queueId: 'q', queueKey: 'k', ciphertext: 'c' });
    expect(primary.sends()).toHaveLength(1);
    expect(secondary.sends()).toHaveLength(0);
  });
});
