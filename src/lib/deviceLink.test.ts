import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { encryptBundle, decryptBundle, buildDeviceLink, parseDeviceLink } from './deviceLink';

describe('deviceLink (P4)', () => {
  it('chiffre puis déchiffre le bundle avec le secret', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const json = JSON.stringify({ v: 1, media: { a: 1 }, x25519: null, ratchet: { b: 2 }, exportedAt: 123 });
    const blob = await encryptBundle(secret, json);
    expect(await decryptBundle(secret, blob)).toBe(json);
  });

  it('échoue avec un mauvais secret', async () => {
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const blob = await encryptBundle(secret, '{"v":1}');
    await expect(decryptBundle(crypto.getRandomValues(new Uint8Array(32)), blob)).rejects.toBeTruthy();
  });

  it('build/parse le lien d’appareil', () => {
    const link = buildDeviceLink('tok123', 'secretB64');
    expect(link.startsWith('nept-device://')).toBe(true);
    expect(parseDeviceLink(link)).toEqual({ tokenId: 'tok123', secretB64: 'secretB64' });
    expect(parseDeviceLink('mauvais-format')).toBeNull();
    expect(parseDeviceLink('nept-device://sanssecret')).toBeNull();
  });
});
