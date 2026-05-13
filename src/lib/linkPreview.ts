// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

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

// URL extraction using native URL API for better performance and security
const extractUrlsInternal = (text: string): string[] => {
  // Use a simple pattern to find potential URLs, then validate with URL API
  const urlPattern = /https?:\/\/[^\s<>"]+/gi;
  const matches = text.match(urlPattern) || [];
  
  // Validate and dedupe using URL API
  const validUrls: string[] = [];
  const seen = new Set<string>();
  
  for (const match of matches) {
    try {
      const url = new URL(match);
      if (!seen.has(url.href)) {
        seen.add(url.href);
        validUrls.push(url.href);
      }
    } catch {
      // Invalid URL, skip
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
    if (SUPABASE_ANON_KEY) {
      headers.apikey = SUPABASE_ANON_KEY;
      headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
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
  try {
    const urlObj = new URL(url);
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      return false;
    }
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