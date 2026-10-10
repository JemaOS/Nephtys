// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// E2E du mode privé via SMP : 2 RelayTransport (le vrai objet du mode privé) +
// SmpRelayWire, contre un broker browser-profile lancé localement.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { RelayTransport } from './relayTransport';
import { SmpRelayWire } from './smpRelayWire';

let broker: ChildProcess | null = null;
const PORT = 20000 + Math.floor(Math.random() * 20000);
const URL = `ws://127.0.0.1:${PORT}/`;

beforeAll(async () => {
  const script = path.resolve(process.cwd(), 'server', 'smp-broker', 'index.mjs');
  broker = spawn(process.execPath, [script], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await new Promise(r => setTimeout(r, 2500));
});

afterAll(() => {
  try {
    broker?.kill();
  } catch {
    /* ignore */
  }
});

async function waitFor(cond: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !cond()) {
    await new Promise(r => setTimeout(r, 100));
  }
}

// E2E réel (lance un broker SMP). Lourd/sensible au timing → hors suite par
// défaut. Lancer explicitement : `SMP_E2E=1 npx vitest run <ce fichier>`.
describe.skipIf(!process.env.SMP_E2E)('mode privé via SMP (queue-level, browser-profile)', () => {
  it('createConnection -> acceptInvite -> send -> receive (2 sens)', async () => {
    const alice = new RelayTransport(new SmpRelayWire({ url: URL }), 150);
    const bob = new RelayTransport(new SmpRelayWire({ url: URL }), 150);

    const { connection, invite } = await alice.createConnection();
    alice.registerConnection('conv', connection);
    bob.acceptInvite('conv', invite);

    const bobReceived: string[] = [];
    bob.subscribe('conv', m => {
      bobReceived.push(m.content);
    });

    await alice.sendMessage({ conversationId: 'conv', senderId: 'a', content: 'CIPHER-1', type: 'text' });
    await waitFor(() => bobReceived.length > 0);
    expect(bobReceived).toEqual(['CIPHER-1']);

    const aliceReceived: string[] = [];
    alice.subscribe('conv', m => {
      aliceReceived.push(m.content);
    });
    await bob.sendMessage({ conversationId: 'conv', senderId: 'b', content: 'CIPHER-2', type: 'text' });
    await waitFor(() => aliceReceived.length > 0);
    expect(aliceReceived).toEqual(['CIPHER-2']);
  }, 30000);
});
