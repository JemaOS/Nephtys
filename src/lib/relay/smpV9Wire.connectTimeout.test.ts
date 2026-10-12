// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { afterEach, describe, expect, it } from 'vitest';
import { SmpV9Wire } from './smpV9Wire';

/** WebSocket qui n'ouvre jamais (handshake bloqué) → doit échouer par délai. */
class HangingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  binaryType = 'blob';
  readyState = 0;
  onopen: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  send(): void {
    /* jamais atteint : la connexion ne s'ouvre pas */
  }
  close(): void {
    /* no-op */
  }
}

describe('SmpV9Wire — délai de connexion au pont', () => {
  const original = (globalThis as { WebSocket?: unknown }).WebSocket;

  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = original;
  });

  it("échoue vite (ne bloque pas) quand le pont ne répond pas", async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = HangingWebSocket;
    const wire = new SmpV9Wire({ bridgeUrl: 'wss://pont.invalide/', timeoutMs: 300 });
    const t0 = Date.now();
    const resp = await wire.request({ op: 'createQueue' });
    const dt = Date.now() - t0;
    expect(resp.ok).toBe(false);
    expect(dt).toBeLessThan(3000);
  });
});
