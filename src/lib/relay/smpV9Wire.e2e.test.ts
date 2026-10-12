import { describe, it, expect } from 'vitest';
import { SmpV9Wire } from './smpV9Wire';

const BRIDGE = process.env.SMP_V9_BRIDGE || 'ws://127.0.0.1:8098';
const run = !!process.env.SMP_V9_E2E;

describe.skipIf(!run)('SmpV9Wire (pont -> SMP v9)', () => {
  it('createQueue -> IDS, puis send/read (aller-retour)', async () => {
    const wire = new SmpV9Wire({ bridgeUrl: BRIDGE, timeoutMs: 15000 });
    const created = await wire.request({ op: 'createQueue' });
    expect(created.ok).toBe(true);
    const creds = created.result as { queueId: string; sendKey: string; rcvKey: string };
    expect(creds.queueId).toBeTruthy();
    expect(creds.sendKey).toBeTruthy();

    // Envoie vers notre propre sndId puis relit (boucle locale)
    const sent = await wire.request({ op: 'send', queueId: creds.queueId, queueKey: creds.sendKey, ciphertext: btoa('bonjour') });
    expect(sent.ok).toBe(true);

    const read = await wire.request({ op: 'read', queueId: creds.queueId, queueKey: creds.rcvKey, relay: BRIDGE });
    expect(read.ok).toBe(true);
    expect(Array.isArray(read.result)).toBe(true);
  }, 40000);
});