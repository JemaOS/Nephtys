// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Fournisseurs d'images animées (GIF / stickers) avec **chaîne de fallbacks**.
 *
 * On essaie, dans l'ordre, plusieurs sources jusqu'à obtenir des résultats :
 *   1. Tenor API v2 (clé privée `VITE_TENOR_API_KEY`, si fournie) ;
 *   2. Tenor API v1 — clés publiques (aucune clé perso requise) ;
 *   3. GIPHY API — clé publique bêta (aucune clé perso requise).
 *
 * Si tout échoue, on renvoie `[]` (l'UI affiche « aucun résultat », jamais de
 * crash). Résultat normalisé au format attendu par l'UI :
 * `{ id, content_description, media_formats: { gif, mediumgif, tinygif, nanogif, webp, tinywebp } }`.
 */

export type GifKind = 'gif' | 'sticker';

export interface GifItem {
  id: string;
  content_description?: string;
  media_formats: Record<string, { url: string }>;
}

const TENOR_V2_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined) || '';
const TENOR_CLIENT_KEY = 'nephtys_app';

// Clés PUBLIQUES (pas de compte requis) — plusieurs pour la redondance.
const TENOR_V1_KEYS = ['LIVDSRZULELA', 'AABBCCDD'];
const GIPHY_PUBLIC_KEYS = ['dc6zaTOxFJmzC'];

function normTenorV2(r: any): GifItem {
  return r as GifItem;
}

function normTenorV1(r: any): GifItem {
  if (r?.media_formats) return r as GifItem;
  const media = r?.media?.[0] ?? {};
  return {
    id: String(r?.id ?? ''),
    content_description: r?.content_description,
    media_formats: {
      gif: media.gif,
      mediumgif: media.mediumgif,
      tinygif: media.tinygif,
      nanogif: media.nanogif,
      webp: media.webp,
      tinywebp: media.tinywebp,
    },
  };
}

function normGiphy(r: any): GifItem {
  const img = r?.images ?? {};
  const orig = img.original ?? {};
  const fixed = img.fixed_height ?? {};
  const small = img.fixed_height_small ?? {};
  const preview = img.preview_gif ?? {};
  const tinyUrl = small.url || preview.url || orig.url;
  return {
    id: String(r?.id ?? ''),
    content_description: r?.title,
    media_formats: {
      gif: { url: orig.url },
      mediumgif: { url: fixed.url || orig.url },
      tinygif: { url: tinyUrl },
      nanogif: { url: preview.url || tinyUrl },
      webp: { url: orig.webp || orig.url },
      tinywebp: { url: small.webp || tinyUrl },
    },
  };
}

async function tryJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function isTrending(query: string): boolean {
  return !query || query === 'trending';
}

/** Récupère GIF ou stickers via la chaîne de fournisseurs (fallbacks). */
export async function fetchGifItems(kind: GifKind, query: string): Promise<GifItem[]> {
  const sticker = kind === 'sticker';
  const trending = isTrending(query);

  // 1) Tenor v2 (clé privée)
  if (TENOR_V2_KEY) {
    const base = trending
      ? `https://tenor.googleapis.com/v2/featured?key=${TENOR_V2_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20${sticker ? '&searchfilter=sticker' : ''}`
      : `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_V2_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20${sticker ? '&searchfilter=sticker' : ''}`;
    const data = await tryJson(base);
    if (data?.results?.length) return data.results.map(normTenorV2);
  }

  // 2) Tenor v1 (clés publiques)
  for (const key of TENOR_V1_KEYS) {
    const base = trending
      ? `https://g.tenor.com/v1/trending?key=${key}&limit=20${sticker ? '&searchfilter=sticker' : ''}`
      : `https://g.tenor.com/v1/search?q=${encodeURIComponent(query)}&key=${key}&limit=20${sticker ? '&searchfilter=sticker' : ''}`;
    const data = await tryJson(base);
    if (data?.results?.length) return data.results.map(normTenorV1);
  }

  // 3) GIPHY (clé publique bêta)
  for (const key of GIPHY_PUBLIC_KEYS) {
    const path = sticker ? 'stickers' : 'gifs';
    const base = trending
      ? `https://api.giphy.com/v1/${path}/trending?api_key=${key}&limit=20&rating=pg-13`
      : `https://api.giphy.com/v1/${path}/search?api_key=${key}&q=${encodeURIComponent(query)}&limit=20&rating=pg-13`;
    const data = await tryJson(base);
    if (data?.data?.length) return data.data.map(normGiphy);
  }

  return [];
}
