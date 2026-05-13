// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState } from 'react';
import { getMediaUrl, getMediaUrlSync } from '@/lib/mediaUrl';

/**
 * Hook React qui résout une URL signée pour un fichier du bucket privé `media`.
 *
 * Usage :
 *   const { url, loading } = useMediaUrl(message.media_url);
 *   <img src={url} />
 *
 * Tant que l'URL signée n'est pas générée, `url` vaut le path d'origine
 * (ne fonctionnera pas pour afficher) et `loading` est true.
 */
export function useMediaUrl(pathOrUrl: string | null | undefined): {
  url: string;
  loading: boolean;
} {
  const initial = pathOrUrl ? getMediaUrlSync(pathOrUrl) : '';
  const [url, setUrl] = useState<string>(initial);
  const [loading, setLoading] = useState<boolean>(
    !!pathOrUrl && initial === pathOrUrl
  );

  useEffect(() => {
    if (!pathOrUrl) {
      setUrl('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const sync = getMediaUrlSync(pathOrUrl);
    if (sync !== pathOrUrl) {
      // URL déjà en cache, pas besoin d'attendre
      setUrl(sync);
      setLoading(false);
      return;
    }

    setLoading(true);
    getMediaUrl(pathOrUrl)
      .then(signed => {
        if (!cancelled) {
          setUrl(signed);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUrl(pathOrUrl);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [pathOrUrl]);

  return { url, loading };
}
