// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { describe, it, expect } from 'vitest';
import { FailoverRelayWire } from './failoverRelayWire';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

const PRIMARY = 'wss://smp.example/';
const SECONDARY = 'supabase';

type Behavior = 'ok' | 'failSoft' | 'hang';

class FakeWire implements RelayWire {
  readonly relayIds: string[];
  calls = 0;
  constructor(
    readonly id: string,
    private readonly behavior: Behavior = 'ok',
    private readonly delayMs = 0,
  ) {
    this.relayIds = [id];
  }
  async request(op: RelayOp): Promise<RelayResponse> {
    if (op.op !== 'createQueue') return { ok: true, result: { id: 'x' } };
    this.calls += 1;
    if (this.behavior === 'hang') return await new Promise<RelayResponse>(() => { /* jamais */ });
    if (this.delayMs > 0) await new Promise(r => setTimeout(r, this.delayMs));
    if (this.behavior === 'failSoft') {
      return { ok: false, error: 'timed out waiting for SMP WebSocket frame' };
    }
    return { ok: true, result: { queueId: this.id, sendKey: 's', rcvKey: 'r', relay: this.id } };
  }
}

describe('FailoverRelayWire — repli borné (hedgeMs)', () => {
  it('préfère le primaire quand il répond dans le budget (repli jamais démarré)', async () => {
    const primary = new FakeWire(PRIMARY, 'ok', 20);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary, undefined, { hedgeMs: 500 });
    const res = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(res.relay).toBe(PRIMARY);
    expect(secondary.calls).toBe(0);
    expect(fw.onFallback).toBe(false);
  });

  it('démarre le repli quand le budget expire si le primaire pend (Tor lent)', async () => {
    const primary = new FakeWire(PRIMARY, 'hang');
    const secondary = new FakeWire(SECONDARY, 'ok', 30);
    const fw = new FailoverRelayWire(primary, secondary, undefined, { hedgeMs: 150 });
    const t0 = Date.now();
    const res = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    const dt = Date.now() - t0;
    expect(res.relay).toBe(SECONDARY);
    expect(secondary.calls).toBe(1);
    expect(fw.onFallback).toBe(true);
    expect(dt).toBeGreaterThanOrEqual(140);
    expect(dt).toBeLessThan(1500);
  });

  it("démarre le repli immédiatement si le primaire échoue avant le budget", async () => {
    const primary = new FakeWire(PRIMARY, 'failSoft', 20);
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary, undefined, { hedgeMs: 5000 });
    const t0 = Date.now();
    const res = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    const dt = Date.now() - t0;
    expect(res.relay).toBe(SECONDARY);
    expect(fw.onFallback).toBe(true);
    expect(dt).toBeLessThan(1000);
  });

  it('sans hedgeMs (défaut) : comportement historique (attente du primaire)', async () => {
    const primary = new FakeWire(PRIMARY, 'failSoft');
    const secondary = new FakeWire(SECONDARY);
    const fw = new FailoverRelayWire(primary, secondary);
    const res = (await fw.request({ op: 'createQueue' })).result as { relay?: string };
    expect(res.relay).toBe(SECONDARY);
    expect(fw.onFallback).toBe(true);
  });
});
