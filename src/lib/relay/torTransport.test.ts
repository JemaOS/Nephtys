// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { createTorSmpWebSocketImpl } from './torSmpTransport';
import { createTorWebSocketImpl, onionHttpBase, torHttpBase } from './torClient';

const V3 = 'a'.repeat(56) + '.onion';
const V2 = 'b'.repeat(16) + '.onion';

describe('onionHttpBase — base HTTP dérivée d’une adresse .onion', () => {
  it('convertit ws://x.onion en http://x.onion', () => {
    expect(onionHttpBase(`ws://${V3}`)).toBe(`http://${V3}`);
  });

  it('préserve le chemin (sans slash final)', () => {
    expect(onionHttpBase(`ws://${V3}/relay/`)).toBe(`http://${V3}/relay`);
  });

  it('accepte une v2 et un schéma https', () => {
    expect(onionHttpBase(`https://${V2}:8080/`)).toBe(`http://${V2}:8080`);
  });

  it('rejette tout ce qui n’est pas une vraie adresse .onion', () => {
    expect(onionHttpBase('')).toBe('');
    expect(onionHttpBase('https://relay.example')).toBe('');
    expect(onionHttpBase('wss://78-232-3-78.sslip.io/')).toBe('');
  });

  it('torHttpBase n’utilise jamais le relais clearnet (aucun repli)', () => {
    expect(torHttpBase(`ws://${V3}`)).toBe(`http://${V3}`);
    // Adresse non-`.onion` ⇒ vide (l’appelant doit refuser, fail-closed).
    expect(torHttpBase('wss://78-232-3-78.sslip.io/')).toBe('');
  });
});

describe('createTorWebSocketImpl — fail-closed sans `.onion`', () => {
  it('refuse (aucun repli en clair) quand aucune `.onion` n’est fournie', async () => {
    await expect(createTorWebSocketImpl('')).rejects.toThrow(/\.onion/);
  });

  it('refuse une base non-`.onion` (jamais le relais opérateur)', async () => {
    await expect(createTorWebSocketImpl('wss://78-232-3-78.sslip.io/')).rejects.toThrow(/\.onion/);
  });
});

describe('socket fantôme Tor — cible la base .onion fournie', () => {
  it('ouvre le flux down et poste chaque trame vers la .onion', async () => {
    const calls: string[] = [];
    let releaseDown: () => void = () => {};
    const torClient = {
      fetch: (url: string) => {
        calls.push(url);
        if (url.includes('/smp/down')) {
          return Promise.resolve({
            body: {
              getReader: () => ({
                read: () => new Promise<{ done: boolean }>(resolve => {
                  releaseDown = () => resolve({ done: true });
                }),
              }),
            },
          });
        }
        return Promise.resolve({ ok: true });
      },
    };

    const Impl = createTorSmpWebSocketImpl({ httpBase: `http://${V3}`, torClient });
    const sock = new Impl('wss://tor.gateway/');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(calls[0]).toBe(`http://${V3}/smp/down?id=${sock.sessionId}`);
    expect(sock.readyState).toBe(1);

    sock.send(new Uint8Array([0xaa, 0xbb, 0xcc]));
    await new Promise(resolve => setTimeout(resolve, 0));

    const up = calls.find(c => c.includes('/smp/up'));
    expect(up).toBe(`http://${V3}/smp/up?id=${sock.sessionId}`);
    releaseDown();
  });
});
