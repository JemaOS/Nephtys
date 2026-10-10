// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, afterEach } from 'vitest';
import { probeLocalAgent } from './relayClient';

const original = (globalThis as { WebSocket?: unknown }).WebSocket;

afterEach(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = original;
});

class OkWs {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    queueMicrotask(() => this.onopen?.());
  }
  close(): void {
    this.onclose?.();
  }
}

class ErrWs {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    queueMicrotask(() => this.onerror?.());
  }
  close(): void {
    this.onclose?.();
  }
}

describe('probeLocalAgent (détection transparente de l\'agent SimpleX)', () => {
  it('détecte un agent qui accepte la connexion', async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = OkWs;
    expect(await probeLocalAgent('ws://agent')).toBe(true);
  });

  it('renvoie false si la connexion échoue', async () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = ErrWs;
    expect(await probeLocalAgent('ws://agent')).toBe(false);
  });
});
