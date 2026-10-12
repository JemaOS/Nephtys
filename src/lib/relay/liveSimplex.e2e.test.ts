// Test live 2 pairs (A↔B) : A établit, B accepte, échange aller-retour via le
// transport SimpleX (SmpV9Wire -> pont -> serveur v14+) avec E2EE (ratchet).
// Exécution : SMP_V9_E2E=1 SMP_V9_BRIDGE=ws://127.0.0.1:8098 npx vitest run ...
import { describe, it, expect } from 'vitest';
import { PrivateMessenger } from './privateMessenger';
import { InMemoryConnectionStore } from './connectionStore';
import { SmpV9Wire } from './smpV9Wire';

const BRIDGE = process.env.SMP_V9_BRIDGE || 'ws://127.0.0.1:8098';
const run = !!process.env.SMP_V9_E2E;

const waitFor = (pred: () => boolean, ms = 40000) => new Promise<void>((res, rej) => {
  const t0 = Date.now();
  const iv = setInterval(() => {
    if (pred()) { clearInterval(iv); res(); }
    else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout')); }
  }, 300);
});

describe.skipIf(!run)('live A<->B via SimpleX (v14+)', () => {
  it('invitation -> message A->B -> réponse B->A (E2EE par-dessus)', async () => {
    const mk = () => new PrivateMessenger(new SmpV9Wire({ bridgeUrl: BRIDGE, timeoutMs: 20000 }), new InMemoryConnectionStore(), 800);
    const A = mk(); const B = mk();
    const CONV = 'conv-e2e';

    const { link } = await A.establish(CONV);
    expect(link.length).toBeGreaterThan(0);
    await B.accept(CONV, link);

    const gotA: string[] = []; const gotB: string[] = [];
    const unsubA = A.subscribe(CONV, t => gotA.push(t));
    const unsubB = B.subscribe(CONV, t => gotB.push(t));

    await new Promise(r => setTimeout(r, 2500));

    // B (accepteur) est l'initiateur X3DH : il envoie en premier.
    await B.send(CONV, 'bonjour A');
    await waitFor(() => gotA.some(t => t.includes('bonjour A')));
    expect(gotA.some(t => t.includes('bonjour A'))).toBe(true);

    // A (créateur) répond.
    await A.send(CONV, 'salut B');
    await waitFor(() => gotB.some(t => t.includes('salut B')));
    expect(gotB.some(t => t.includes('salut B'))).toBe(true);

    unsubA(); unsubB();
  }, 90000);
});