// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import React from 'react';
import { useMediaUrl } from '@/hooks/useMediaUrl';

type MediaImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  /** Path nu (ou URL Supabase) du fichier dans le bucket privé `media`. */
  src: string | null | undefined;
  /** Fallback affiché tant que l'URL signée n'est pas générée. */
  fallback?: React.ReactNode;
};

/**
 * <img> qui résout automatiquement les URLs signées pour le bucket privé `media`.
 *
 * Remplace les anciens `<img src={profile.avatar_url} />` par
 * `<MediaImg src={profile.avatar_url} />` partout où on affiche un fichier
 * stocké dans le bucket privé.
 */
export const MediaImg: React.FC<MediaImgProps> = ({ src, fallback, ...rest }) => {
  const { url, loading } = useMediaUrl(src);

  if (loading || !url) {
    return fallback ? <>{fallback}</> : null;
  }

  return <img {...rest} src={url} />;
};
