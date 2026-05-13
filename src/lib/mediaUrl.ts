// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Helper centralisé pour obtenir une URL d'accès à un fichier du bucket `media`.
 *
 * Le bucket est PRIVÉ : on doit générer une URL signée (createSignedUrl)
 * pour que le navigateur puisse charger le fichier. Les URLs signées sont
 * valides 1 heure puis renouvelées automatiquement via le cache.
 *
 * Cas d'usage :
 *   • avatars/<userId>/...    → URL signée (visible par tous les authentifiés)
 *   • groups/<convId>/...     → URL signée (visible par les membres de la conv)
 *   • <userId>/<folder>/...   → URL signée (visible par les membres de la conv)
 *   • restored/<userId>/...   → URL signée (visible par le propriétaire)
 */

import { supabase } from './supabase';

const BUCKET = 'media';
const SIGN_DURATION_SECONDS = 60 * 60; // 1 heure
const CACHE_DURATION_MS = (SIGN_DURATION_SECONDS - 300) * 1000; // refresh 5min avant expiration

interface CachedUrl {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CachedUrl>();

/**
 * Extrait le path interne du bucket à partir d'une URL Supabase complète,
 * ou retourne l'input s'il s'agit déjà d'un path nu.
 */
export function extractStoragePath(urlOrPath: string): string {
  if (!urlOrPath) return '';

  // URL signée : .../object/sign/media/<path>?token=...
  const signedMatch = /\/object\/sign\/media\/([^?]+)/.exec(urlOrPath);
  if (signedMatch) return decodeURIComponent(signedMatch[1]);

  // URL publique : .../object/public/media/<path>
  const publicMatch = /\/object\/public\/media\/(.+)/.exec(urlOrPath);
  if (publicMatch) return decodeURIComponent(publicMatch[1]);

  // URL d'accès direct : .../object/media/<path>
  const directMatch = /\/object\/media\/(.+)/.exec(urlOrPath);
  if (directMatch) return decodeURIComponent(directMatch[1]);

  // Sinon : on suppose que c'est déjà un path
  return urlOrPath;
}

/**
 * Génère (ou récupère depuis cache) une URL signée pour un fichier du bucket.
 * Accepte soit un path nu (`avatars/abc/photo.png`) soit une URL Supabase complète.
 */
export async function getMediaUrl(pathOrUrl: string): Promise<string> {
  if (!pathOrUrl) return '';

  const path = extractStoragePath(pathOrUrl);
  if (!path) return pathOrUrl;

  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGN_DURATION_SECONDS);

  if (error || !data?.signedUrl) {
    console.warn('[mediaUrl] Failed to sign URL for', path, error);
    // Fallback sur l'URL d'origine (pourrait fonctionner si le bucket
    // était encore en mode public pour ce fichier)
    return pathOrUrl;
  }

  urlCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + CACHE_DURATION_MS,
  });

  return data.signedUrl;
}

/**
 * Version synchrone : renvoie immédiatement l'URL signée si en cache,
 * sinon déclenche la génération en arrière-plan et retourne le path
 * (qui ne marchera pas, mais l'appelant peut re-render quand l'URL arrive).
 *
 * À utiliser dans les contextes où on ne peut pas attendre (ex. props
 * synchrones de composants). Préfère `useMediaUrl` pour React.
 */
export function getMediaUrlSync(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  const path = extractStoragePath(pathOrUrl);
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  // Déclencher la génération en arrière-plan
  getMediaUrl(pathOrUrl).catch(() => {
    /* erreur déjà loguée */
  });
  return pathOrUrl;
}

/**
 * Pré-charge plusieurs URLs en parallèle (utile pour la liste de messages).
 */
export async function preloadMediaUrls(pathsOrUrls: string[]): Promise<void> {
  await Promise.all(pathsOrUrls.map(p => getMediaUrl(p).catch(() => undefined)));
}

/**
 * Invalide le cache pour un path donné (à appeler après une mise à jour
 * de fichier, ou à la déconnexion).
 */
export function invalidateMediaUrl(pathOrUrl: string): void {
  const path = extractStoragePath(pathOrUrl);
  urlCache.delete(path);
}

export function clearMediaUrlCache(): void {
  urlCache.clear();
}

/**
 * Heuristique : un path/URL fait-il référence au bucket privé `media` ?
 * Sert à éviter de tenter de signer des URLs externes (https://i.imgur.com/...).
 */
function isMediaBucketRef(value: string): boolean {
  if (!value) return false;
  // URL Supabase contenant le bucket
  if (value.includes('/object/sign/media/')) return true;
  if (value.includes('/object/public/media/')) return true;
  if (value.includes('/object/media/')) return true;
  // Path nu (commence par avatars/, groups/, restored/, ou un UUID v4)
  if (/^(avatars|groups|restored)\//.test(value)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i.test(value)) return true;
  return false;
}

/**
 * Résout un path/URL en URL signée si c'est un fichier du bucket privé,
 * sinon retourne la valeur d'origine inchangée. Async, à utiliser après fetch.
 */
export async function resolveMediaUrl(value: string | null | undefined): Promise<string | null | undefined> {
  if (!value) return value;
  if (!isMediaBucketRef(value)) return value;
  return getMediaUrl(value);
}

/**
 * Signe en parallèle tous les avatars/medias d'un objet, en mutant les champs.
 * Retourne le même objet pour faciliter le chaining.
 */
export async function signFields<T extends Record<string, unknown>>(
  obj: T | null | undefined,
  fields: string[]
): Promise<T | null | undefined> {
  if (!obj) return obj;
  await Promise.all(
    fields.map(async f => {
      const v = obj[f];
      if (typeof v === 'string' && v) {
        const signed = await resolveMediaUrl(v);
        (obj as Record<string, unknown>)[f] = signed ?? v;
      }
    })
  );
  return obj;
}

/**
 * Variante batch pour une liste d'objets (ex. messages, profiles).
 */
export async function signFieldsBatch<T extends Record<string, unknown>>(
  list: T[] | null | undefined,
  fields: string[]
): Promise<T[]> {
  if (!list || list.length === 0) return [];
  await Promise.all(list.map(item => signFields(item, fields)));
  return list;
}
