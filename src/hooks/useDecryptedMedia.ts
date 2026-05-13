// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { useEffect, useState } from 'react';
import { fetchAndDecryptMedia } from '@/lib/encryptedMediaService';
import { useMediaUrl } from './useMediaUrl';

interface Options {
  /** Si true, le média est chiffré E2EE et passe par fetchAndDecryptMedia */
  encrypted: boolean;
  /** ID du message (requis si encrypted=true) */
  messageId?: string;
  /** ID du user courant (requis si encrypted=true) */
  userId?: string;
  /** Path/URL du fichier dans le bucket */
  src: string | null | undefined;
}

/**
 * Hook unifié pour afficher un média :
 *  - Si encrypted=false : utilise useMediaUrl (URL signée du bucket privé)
 *  - Si encrypted=true : télécharge le binaire chiffré, le déchiffre,
 *    retourne un blob URL local
 */
export function useDecryptedMedia(opts: Options): { url: string; loading: boolean; error: string | null } {
  const fallbackUrl = useMediaUrl(opts.encrypted ? null : opts.src);

  const [url, setUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(opts.encrypted);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opts.encrypted) return;
    if (!opts.src || !opts.messageId || !opts.userId) {
      setUrl('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchAndDecryptMedia(opts.messageId, opts.src, opts.userId)
      .then(blobUrl => {
        if (!cancelled) {
          setUrl(blobUrl);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          console.warn('[useDecryptedMedia] decrypt failed:', err);
          setError(err.message || 'Déchiffrement échoué');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [opts.encrypted, opts.messageId, opts.userId, opts.src]);

  if (!opts.encrypted) {
    return {
      url: fallbackUrl.url,
      loading: fallbackUrl.loading,
      error: null,
    };
  }

  return { url, loading, error };
}
