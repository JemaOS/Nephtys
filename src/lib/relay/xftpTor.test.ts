// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { torFetch } = vi.hoisted(() => ({ torFetch: vi.fn(async () => ({ ok: true })) }));

vi.mock('./torClient', async importOriginal => {
  const actual = await importOriginal<typeof import('./torClient')>();
  return {
    ...actual,
    getTorClient: vi.fn(async () => ({ fetch: torFetch })),
  };
});

vi.mock('../smpweb/browser-xftp-web-client.mjs', () => ({
  connectBrowserXftpWebClient: vi.fn(async () => ({ profile: 'mock-xftp' })),
  uploadXftpWebFile: vi.fn(),
  downloadXftpWebFile: vi.fn(),
}));

import { connectBrowserXftpWebClient } from '../smpweb/browser-xftp-web-client.mjs';
import { connectXftp, createXftpTorFetchImpl } from './xftpClient';

const V3 = 'a'.repeat(56) + '.onion';
const ADDRESS = 'xftp://AAAA@xftp1.simplex.im';

beforeEach(() => {
  localStorage.clear();
  torFetch.mockClear();
  vi.mocked(connectBrowserXftpWebClient).mockClear();
});

describe('transfert XFTP sous Tor', () => {
  it('refuse de construire un transport sans `.onion` valide', () => {
    expect(() => createXftpTorFetchImpl('')).toThrow(/\.onion/);
    expect(() => createXftpTorFetchImpl('https://relay.example')).toThrow(/\.onion/);
  });

  it('réécrit la requête vers /xftp de la .onion, via torClient.fetch (jamais en direct)', async () => {
    const fetchImpl = createXftpTorFetchImpl(`ws://${V3}`);
    await fetchImpl('https://xftp1.simplex.im/', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(torFetch).toHaveBeenCalledTimes(1);
    const [url, init] = torFetch.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe(`http://${V3}/xftp?host=xftp1.simplex.im&port=443`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-xftp-host']).toBe('xftp1.simplex.im');
    expect(init.headers['x-xftp-port']).toBe('443');
  });

  it('connectXftp sous Tor route via la .onion et ne refuse plus', async () => {
    localStorage.setItem('nephtys_smp_onion_url', V3);
    localStorage.setItem('nephtys_tor_enabled', '1');

    await connectXftp(ADDRESS);

    expect(connectBrowserXftpWebClient).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(connectBrowserXftpWebClient).mock.calls[0][0] as { fetchImpl?: unknown };
    expect(typeof opts.fetchImpl).toBe('function');
  });

  it('connectXftp sans Tor garde le chemin direct (fetch natif)', async () => {
    await connectXftp(ADDRESS);
    const opts = vi.mocked(connectBrowserXftpWebClient).mock.calls[0][0] as { fetchImpl?: unknown };
    expect(opts.fetchImpl).toBeUndefined();
  });
});
