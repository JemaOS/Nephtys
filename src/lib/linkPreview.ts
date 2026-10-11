// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { safeHttpUrl } from '@/lib/safeUrl';
import { supabase } from '@/lib/supabase';

/**
 * Link Preview Service
 * Handles URL detection and Open Graph metadata fetching
 */

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
  domain: string;
}

// Pattern volontairement simple (classe de caractères, pas de backtracking
// catastrophique) : on repère des candidats puis on valide avec safeHttpUrl.
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
// Ponctuation qui termine souvent une phrase mais ne fait pas partie de l'URL.
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/**
 * Retire la ponctuation finale (`.,;:!?)]}` etc.) collée à une URL détectée
 * dans une phrase, sans regex coûteuse.
 */
const stripTrailingPunctuation = (raw: string): string => {
  const trailing = TRAILING_PUNCTUATION.exec(raw);
  return trailing ? raw.slice(0, raw.length - trailing[0].length) : raw;
};

// URL extraction using native URL API for better performance and security
const extractUrlsInternal = (text: string): string[] => {
  if (!text) return [];

  const validUrls: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(URL_PATTERN)) {
    // safeHttpUrl rejette javascript:/data:/etc. et ne garde que http(s).
    const href = safeHttpUrl(stripTrailingPunctuation(match[0]));
    if (href && !seen.has(href)) {
      seen.add(href);
      validUrls.push(href);
    }
  }

  return validUrls;
}

/**
 * Extract URLs from text
 * @param text - The text to search for URLs
 * @returns Array of URLs found in the text
 */
export function extractUrls(text: string): string[] {
  return extractUrlsInternal(text);
}

/**
 * Segment de texte : soit du texte brut, soit une URL validée et cliquable.
 * `href` n'est renseigné que pour les segments `url` et provient toujours de
 * `safeHttpUrl` (schéma http/https uniquement, jamais javascript:/data:).
 */
export interface TextUrlSegment {
  type: 'text' | 'url';
  value: string;
  href?: string;
}

const WWW_PREFIX = /^www\./i;

/**
 * Découpe un texte en segments texte/URL pour un rendu linkifié SANS
 * injection de HTML brut (nœuds React uniquement). Chaque URL est validée par
 * safeHttpUrl ; les URL invalides (ou dangereuses) restent du texte brut.
 */
export function splitTextByUrls(text: string): TextUrlSegment[] {
  if (!text) return [];

  const segments: TextUrlSegment[] = [];
  const pattern = new RegExp(URL_PATTERN.source, 'gi');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }

    const candidate = stripTrailingPunctuation(raw);
    const trailing = raw.slice(candidate.length);
    const hrefCandidate = WWW_PREFIX.test(candidate) ? `https://${candidate}` : candidate;
    const href = safeHttpUrl(hrefCandidate);

    if (href) {
      segments.push({ type: 'url', value: candidate, href });
      if (trailing) segments.push({ type: 'text', value: trailing });
    } else {
      segments.push({ type: 'text', value: raw });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return segments;
}

/**
 * Extract domain from URL
 * @param url - The URL to extract domain from
 * @returns The domain name
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return url;
  }
}

// Cache local en mémoire pour éviter les fetches répétés sur le même URL
// pendant la même session (ex: l'utilisateur efface puis retape le même lien).
const memoryCache = new Map<string, { data: LinkPreviewData | null; expires: number }>();
const MEMORY_TTL_MS = 30 * 60 * 1000; // 30 min

const SUPABASE_URL =
  (import.meta as any).env?.VITE_SUPABASE_URL || 'https://imkfbalgviqeotpjogff.supabase.co';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY as string | undefined;

const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/link-preview`;
// Timeout côté client : on laisse une marge au-dessus du timeout serveur (4s)
const CLIENT_TIMEOUT_MS = 5000;

async function fetchFromEdgeFunction(url: string): Promise<LinkPreviewData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (SUPABASE_ANON_KEY) headers.apikey = SUPABASE_ANON_KEY;
    // La fonction edge exige un JWT UTILISATEUR (anti-abus/SSRF) : on envoie
    // le jeton de session. Repli sur la clé anon si non connecté (la fonction
    // renvoie alors 401 → on retombe sur le fallback client, YouTube oEmbed).
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? SUPABASE_ANON_KEY;
      if (token) headers.Authorization = `Bearer ${token}`;
    } catch {
      if (SUPABASE_ANON_KEY) headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    }
    const res = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: LinkPreviewData };
    return json.data ?? null;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.warn('[linkPreview] edge function timeout');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fallback rapide : pour YouTube on peut utiliser oEmbed directement depuis le
 * navigateur (CORS ouvert, < 200ms). Utile si l'edge function est down.
 */
async function fetchYouTubeOEmbedClient(url: string): Promise<LinkPreviewData | null> {
  try {
    const u = new URL(url);
    const isYT =
      u.hostname.endsWith('youtube.com') ||
      u.hostname.endsWith('youtu.be') ||
      u.hostname.endsWith('youtube-nocookie.com');
    if (!isYT) return null;

    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      url,
      title: data.title || null,
      description: null,
      image: data.thumbnail_url || null,
      siteName: data.author_name || 'YouTube',
      domain: extractDomain(url),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch Open Graph metadata for a URL.
 *
 * Stratégie :
 *   1. Cache mémoire (30 min) — instantané
 *   2. Edge function `link-preview` — rapide grâce au cache DB et au cas
 *      spécial YouTube oEmbed côté serveur
 *   3. Fallback YouTube oEmbed côté client si edge function indispo
 *   4. Sinon, on retourne un preview minimal avec juste le domaine pour
 *      que l'UI affiche QUELQUE CHOSE plutôt que rien
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  // 1) Cache mémoire
  const cached = memoryCache.get(url);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  // 2) Edge function
  let data = await fetchFromEdgeFunction(url);

  // 3) Fallback YouTube côté client si pas de titre dans la réponse
  if (!data?.title) {
    const yt = await fetchYouTubeOEmbedClient(url);
    if (yt?.title) data = yt;
  }

  // 4) Fallback minimal — au moins le domaine s'affiche
  if (!data) {
    data = {
      url,
      title: null,
      description: null,
      image: null,
      siteName: null,
      domain: extractDomain(url),
    };
  }

  memoryCache.set(url, { data, expires: Date.now() + MEMORY_TTL_MS });
  return data;
}

/**
 * Debounce function to limit API calls
 * @param func - The function to debounce
 * @param wait - The debounce delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    
    timeoutId = setTimeout(() => {
      func(...args);
    }, wait);
  };
}

/**
 * Check if a URL is valid and should have a preview fetched
 * @param url - The URL to validate
 * @returns Boolean indicating if URL is valid for preview
 */
export function isValidPreviewUrl(url: string): boolean {
  // Réutilise le garde-fou partagé : seuls http/https passent, jamais
  // javascript:/data:/etc.
  const safe = safeHttpUrl(url);
  if (!safe) return false;
  try {
    const urlObj = new URL(safe);
    // Exclude common file extensions that don't have OG metadata
    const excludedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar', '.7z', '.tar', '.gz'];
    const pathname = urlObj.pathname.toLowerCase();
    if (excludedExtensions.some(ext => pathname.endsWith(ext))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the first valid URL from text for preview
 * @param text - The text to search for URLs
 * @returns The first valid URL or null
 */
export function getFirstPreviewUrl(text: string): string | null {
  const urls = extractUrls(text);
  for (const url of urls) {
    if (isValidPreviewUrl(url)) {
      return url;
    }
  }
  return null;
}