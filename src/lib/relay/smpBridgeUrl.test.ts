// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { beforeEach, describe, expect, it } from 'vitest';
import { getSmpBridgeUrl } from './relayClient';

const KEY = 'nephtys_smp_v9_bridge_url';

beforeEach(() => {
  localStorage.clear();
});

describe('getSmpBridgeUrl — réparation du chemin hérité /smp', () => {
  it('réécrit /smp → /simplex pour un override local périmé, et le persiste', () => {
    localStorage.setItem(KEY, 'wss://78-232-3-78.sslip.io/smp');
    expect(getSmpBridgeUrl()).toBe('wss://78-232-3-78.sslip.io/simplex');
    // Migration persistée (une seule fois).
    expect(localStorage.getItem(KEY)).toBe('wss://78-232-3-78.sslip.io/simplex');
  });

  it('réécrit /smp → /simplex en conservant un ?host=', () => {
    localStorage.setItem(KEY, 'wss://78-232-3-78.sslip.io/smp?host=smp12.simplex.im');
    expect(getSmpBridgeUrl()).toBe('wss://78-232-3-78.sslip.io/simplex?host=smp12.simplex.im');
  });

  it('respecte un chemin custom (non /smp)', () => {
    localStorage.setItem(KEY, 'wss://relais.exemple/pont');
    expect(getSmpBridgeUrl()).toBe('wss://relais.exemple/pont');
  });

  it('défaut = /simplex sans override', () => {
    expect(getSmpBridgeUrl()).toBe('wss://78-232-3-78.sslip.io/simplex');
  });
});
