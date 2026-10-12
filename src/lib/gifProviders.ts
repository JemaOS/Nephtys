// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Fournisseurs d'images animées (GIF / stickers).
 *
 * ⚠️ ANONYMAT RÉSEAU : ces API tierces sont appelées DIRECTEMENT depuis le
 * navigateur → elles voient l'IP + le texte recherché de l'utilisateur. Depuis
 * 2026-10-35 :
 *   • AUCUNE clé en dur n'est plus embarquée dans le bundle (les anciennes clés
 *     publiques Tenor v1 / GIPHY étaient publiques mais associées à un quota
 *     partagé et identifiaient l'app) ;
 *   • la recherche est DÉSACTIVÉE en mode Tor strict (fuite d'IP → deanonymisation) ;
 *   • il ne reste que Tenor v2 (clé PRIVÉE `VITE_TENOR_API_KEY`, si fournie) puis
 *     Openverse (API publique sans clé, avec CORS).
 *
 * Limite résiduelle documentée : hors mode Tor, Openverse/Tenor voient toujours
 * l'IP + la requête. Un vrai anonymat exigerait de PROXIFIER ces appels par une
 * edge function (à faire si la fonctionnalité doit rester disponible en Tor).
 *
 * Résultat normalisé au format attendu par l'UI :
 * `{ id, content_description, media_formats: { gif, mediumgif, tinygif, nanogif, webp, tinywebp } }`.
 */

import { isTorRelayEnabled } from '@/lib/relay/relayClient';

export type GifKind = 'gif' | 'sticker';

export interface GifItem {
  id: string;
  content_description?: string;
  media_formats: Record<string, { url: string }>;
}

const TENOR_V2_KEY = (import.meta.env.VITE_TENOR_API_KEY as string | undefined) || '';
const TENOR_CLIENT_KEY = 'nephtys_app';

function normTenorV2(r: any): GifItem {
  return r as GifItem;
}

/** Openverse (openverse.org) — API PUBLIQUE SANS CLÉ, avec CORS. */
function normOpenverse(r: any): GifItem {
  // On utilise l'URL DIRECTE de l'image (l'endpoint `/thumb/` d'Openverse
  // renvoie 424, pas une image). Toutes les tailles pointent donc sur `url`.
  const full = r?.url;
  return {
    id: String(r?.id ?? ''),
    content_description: r?.title,
    media_formats: {
      gif: { url: full },
      mediumgif: { url: full },
      tinygif: { url: full },
      nanogif: { url: full },
      webp: { url: full },
      tinywebp: { url: full },
    },
  };
}

const OPENVERSE_DEFAULT_QUERIES = ['funny', 'cat', 'dance', 'wow', 'hello', 'love'];

async function tryOpenverse(kind: GifKind, query: string): Promise<GifItem[]> {
  const q = isTrending(query)
    ? OPENVERSE_DEFAULT_QUERIES[Math.floor(Math.random() * OPENVERSE_DEFAULT_QUERIES.length)]
    : query;
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&extension=gif&mature=false&page_size=20`;
  const data = await tryJson(url);
  if (!data?.results?.length) return [];
  return data.results
    .filter((r: any) => r?.url)
    .map(normOpenverse);
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

/** Récupère GIF ou stickers via les fournisseurs restants (sans clé en dur). */
export async function fetchGifItems(kind: GifKind, query: string): Promise<GifItem[]> {
  // Fail-closed en mode Tor : toute requête vers un tiers (Tenor/Openverse)
  // exposerait l'IP réelle de l'appareil et la requête de l'utilisateur.
  if (isTorRelayEnabled()) return [];

  const sticker = kind === 'sticker';
  const trending = isTrending(query);

  // 1) Tenor v2 (clé PRIVÉE fournie par le déployeur — jamais en dur)
  if (TENOR_V2_KEY) {
    const base = trending
      ? `https://tenor.googleapis.com/v2/featured?key=${TENOR_V2_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20${sticker ? '&searchfilter=sticker' : ''}`
      : `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_V2_KEY}&client_key=${TENOR_CLIENT_KEY}&limit=20${sticker ? '&searchfilter=sticker' : ''}`;
    const data = await tryJson(base);
    if (data?.results?.length) return data.results.map(normTenorV2);
  }

  // 2) Openverse (API PUBLIQUE SANS CLÉ + CORS) — source fiable par défaut.
  {
    const items = await tryOpenverse(kind, query);
    if (items.length) return items;
  }

  return [];
}
