// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

import { beforeEach, describe, expect, it } from 'vitest';
import { netLog, netLogClear, netLogSize, netLogSnapshot, netLogSubscribe } from './netLog';

beforeEach(() => {
  netLogClear();
});

describe('netLog — anneau borné + observabilité', () => {
  it('publie puis renvoie une copie du journal', () => {
    netLog({ layer: 'tor', op: 'bootstrap', status: 'start' });
    netLog({ layer: 'smp-v9', op: 'createQueue', status: 'ok', ms: 12 });
    const snap = netLogSnapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0].layer).toBe('tor');
    expect(snap[1].op).toBe('createQueue');
    expect(snap[1].ms).toBe(12);
  });

  it('notifie les abonnés, puis se désabonne proprement', () => {
    const seen: string[] = [];
    const unsub = netLogSubscribe(e => seen.push(e.op));
    netLog({ layer: 'relay', op: 'fallback', status: 'fallback' });
    expect(seen).toEqual(['fallback']);
    unsub();
    netLog({ layer: 'relay', op: 'x', status: 'ok' });
    expect(seen).toEqual(['fallback']);
  });

  it('borne la taille du journal (anneau) en gardant les plus récents', () => {
    for (let i = 0; i < 500; i++) netLog({ layer: 'smp', op: `op${i}`, status: 'ok' });
    expect(netLogSize()).toBeLessThanOrEqual(400);
    const snap = netLogSnapshot();
    expect(snap[snap.length - 1].op).toBe('op499');
  });

  it('netLogClear vide le journal', () => {
    netLog({ layer: 'smp', op: 'a', status: 'ok' });
    netLogClear();
    expect(netLogSize()).toBe(0);
    expect(netLogSnapshot()).toEqual([]);
  });
});
