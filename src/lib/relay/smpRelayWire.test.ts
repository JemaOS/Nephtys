// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Tests unitaires de SmpRelayWire (transport SMP) : tag `relay` des credentials
// et drainage borné multi-enveloppes par `read`. Le client SMP vendoré est
// remplacé par un double de test (aucun broker requis).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  messages: [] as Array<{ msgId: Uint8Array; body: Uint8Array }>,
  ackIds: [] as string[],
}));

vi.mock('@/lib/smpweb/browser-smp-websocket-transport.mjs', () => ({
  connectBrowserSmpWebSocketTransport: vi.fn(async () => ({})),
}));

vi.mock('@/lib/smpweb/browser-smp-client.mjs', () => ({
  createBrowserSmpClient: vi.fn(() => ({
    createQueue: vi.fn(async () => ({
      server: null,
      queueMode: 'messaging',
      rcvId: new Uint8Array([1, 2, 3]),
      rcvSignKey: { publicKeyDer: new Uint8Array([4]), secretKey: new Uint8Array([5]) },
      serverDhSecret: new Uint8Array([6]),
      sndId: new Uint8Array([7]),
    })),
    secureQueue: vi.fn(async () => ({})),
    subscribeQueue: vi.fn(async () => ({})),
    receiveQueueMessage: vi.fn(async () => {
      if (!h.messages.length) throw new Error('SMP_CLIENT_TIMEOUT');
      return { message: h.messages.shift()! };
    }),
    acknowledgeMessage: vi.fn(async (_queue: unknown, id: Uint8Array) => {
      h.ackIds.push(Buffer.from(id).toString('base64url'));
      return {};
    }),
    sendQueueMessage: vi.fn(async () => ({})),
    deleteQueue: vi.fn(async () => ({})),
  })),
}));

vi.mock('@/lib/smpweb/browser-smp-core.mjs', () => ({
  generateEd25519KeyPair: vi.fn(() => ({
    publicKeyDer: new Uint8Array([9]),
    secretKey: new Uint8Array([10]),
  })),
  encodeBase64Url: vi.fn((b: Uint8Array) => Buffer.from(b).toString('base64url')),
  decodeBase64Url: vi.fn((s: string) => new Uint8Array(Buffer.from(s || '', 'base64url'))),
  utf8Bytes: vi.fn((s: string) => new TextEncoder().encode(s)),
  utf8Text: vi.fn((b: Uint8Array) => new TextDecoder().decode(b)),
}));

vi.mock('@/lib/smpweb/browser-smp-agent.mjs', () => ({
  decryptRcvMessageBody: vi.fn(({ encryptedBody }: { encryptedBody: Uint8Array }) => ({ body: encryptedBody })),
}));

import { SmpRelayWire, MAX_READ_ENVELOPES } from './smpRelayWire';
import type { StoredEnvelope } from './relayCore';

const URL = 'wss://smp.example/';
// Token de file compact : `server|mode|rcvId|rcvPub|rcvSec|dhSecret`.
const QUEUE_ID = ['', '', 'rcv', 'pub', 'sec', 'secret'].join('|');

function fill(n: number): void {
  h.messages = [];
  for (let i = 1; i <= n; i++) {
    h.messages.push({ msgId: new Uint8Array([i]), body: new Uint8Array([100 + i]) });
  }
}

async function read(wire: SmpRelayWire, limit?: number): Promise<StoredEnvelope[]> {
  const resp = await wire.request({ op: 'read', queueId: QUEUE_ID, queueKey: 'r', limit });
  expect(resp.ok).toBe(true);
  return (resp.result as StoredEnvelope[]) ?? [];
}

beforeEach(() => {
  h.messages = [];
  h.ackIds = [];
});

describe('SmpRelayWire — tag du relais hôte', () => {
  it('tague les credentials de file avec l’URL du relais', async () => {
    const wire = new SmpRelayWire({ url: URL });
    const resp = await wire.request({ op: 'createQueue' });
    expect(resp.ok).toBe(true);
    expect((resp.result as { relay?: string }).relay).toBe(URL);
    expect(wire.relayIds).toEqual([URL]);
  });
});

describe('SmpRelayWire — drainage borné (débit)', () => {
  it('renvoie plusieurs enveloppes par read, dans l’ordre, sans perte ni doublon', async () => {
    const wire = new SmpRelayWire({ url: URL });
    const total = MAX_READ_ENVELOPES + 5; // dépasse la borne → prouve le drainage borné
    fill(total);
    const first = await read(wire);
    expect(first).toHaveLength(MAX_READ_ENVELOPES); // borne N (défaut 100)
    // Ordre préservé et ids uniques.
    expect(first.map(e => e.id)).toEqual(
      Array.from({ length: MAX_READ_ENVELOPES }, (_, i) => Buffer.from([i + 1]).toString('base64url')),
    );
    expect(new Set(first.map(e => e.id)).size).toBe(first.length);

    // Le reste n'a pas été perdu : il sort au tick suivant.
    const second = await read(wire);
    expect(second).toHaveLength(total - MAX_READ_ENVELOPES);

    // Plus rien.
    expect(await read(wire)).toEqual([]);

    // Aucun doublon sur l'ensemble des deux lectures.
    const all = [...first, ...second].map(e => e.id);
    expect(new Set(all).size).toBe(total);
  });

  it('respecte une limite explicite (sous la borne) sans perdre le reste', async () => {
    const wire = new SmpRelayWire({ url: URL });
    fill(5);
    const limited = await read(wire, 3);
    expect(limited).toHaveLength(3);
    expect(await read(wire)).toHaveLength(2);
  });

  it('n’acquitte rien à la lecture : l’ack des ids reçus reste exact et unique', async () => {
    const wire = new SmpRelayWire({ url: URL });
    fill(3);
    const envs = await read(wire);
    expect(envs).toHaveLength(3);
    expect(h.ackIds).toEqual([]); // aucun ack implicite pendant le read

    const ack = await wire.request({
      op: 'ack',
      queueId: QUEUE_ID,
      queueKey: 'r',
      ids: envs.map(e => e.id),
    });
    expect(ack.ok).toBe(true);
    expect(h.ackIds).toEqual(envs.map(e => e.id)); // un ack par id, ni plus ni moins
  });
});

describe('SmpRelayWire — borne de drainage configurable (VITE_SMP_READ_MAX)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadMax(value: string | undefined): Promise<number> {
    vi.resetModules();
    vi.stubEnv('VITE_SMP_READ_MAX', value);
    const mod = await import('./smpRelayWire');
    return mod.MAX_READ_ENVELOPES;
  }

  it('défaut = 100 quand VITE_SMP_READ_MAX est absent', async () => {
    expect(await loadMax(undefined)).toBe(100);
  });

  it('respecte VITE_SMP_READ_MAX', async () => {
    expect(await loadMax('5')).toBe(5);
    expect(await loadMax('250')).toBe(250);
  });

  it('borne la valeur à [1, 1000]', async () => {
    expect(await loadMax('9999')).toBe(1000);
    expect(await loadMax('0')).toBe(1);
    expect(await loadMax('-7')).toBe(1);
  });

  it('valeur non numérique → retombe sur le défaut', async () => {
    expect(await loadMax('abc')).toBe(100);
  });
});
