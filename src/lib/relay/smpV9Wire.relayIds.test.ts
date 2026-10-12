// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { describe, it, expect } from 'vitest';
import { SmpV9Wire } from './smpV9Wire';

describe('SmpV9Wire — relayIds (routage par file)', () => {
  it("expose l'URL effective du pont (avec ?host=) comme tag de file", () => {
    const withHost = new SmpV9Wire({ bridgeUrl: 'wss://pont.exemple/simplex', host: 'smp10.simplex.im' });
    expect(withHost.relayIds).toEqual(['wss://pont.exemple/simplex?host=smp10.simplex.im']);

    const noHost = new SmpV9Wire({ bridgeUrl: 'wss://pont.exemple/simplex' });
    expect(noHost.relayIds).toEqual(['wss://pont.exemple/simplex']);
  });
});
