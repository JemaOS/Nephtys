import { describe, it, expect, vi } from 'vitest';
import { fetchGifItems } from './gifProviders';

describe('gifProviders (fallbacks)', () => {
  it('retombe sur Openverse (sans clé) et normalise le résultat', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('openverse.org')) {
        return {
          ok: true,
          json: async () => ({
            results: [{ id: '1', title: 'cat', url: 'https://x/a.gif', thumbnail: 'https://x/t.png' }],
          }),
        } as unknown as Response;
      }
      return { ok: false, json: async () => ({}) } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const items = await fetchGifItems('gif', 'cat');
    expect(items).toHaveLength(1);
    expect(items[0].media_formats.gif.url).toBe('https://x/a.gif');
    expect(items[0].media_formats.tinygif.url).toBe('https://x/t.png');
    expect(items[0].content_description).toBe('cat');

    vi.unstubAllGlobals();
  });

  it('renvoie [] si toutes les sources échouent (pas de crash)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) }) as unknown as Response));
    const items = await fetchGifItems('sticker', 'wow');
    expect(items).toEqual([]);
    vi.unstubAllGlobals();
  });
});
