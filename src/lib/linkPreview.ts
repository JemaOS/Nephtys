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

/**
 * Fetch Open Graph metadata for a URL using Microlink API
 * @param url - The URL to fetch metadata for
 * @returns LinkPreviewData or null if fetch fails
 */
export async function fetchLinkPreview(url: string): Promise<LinkPreviewData | null> {
  try {
    // Use Microlink API for fetching Open Graph data
    // This is a free API that handles CORS and returns OG metadata
    const apiUrl = `https://api.microlink.io/?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      console.error('Failed to fetch link preview:', response.status);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status !== 'success' || !data.data) {
      console.error('Invalid response from Microlink API:', data);
      return null;
    }
    
    const { title, description, image, publisher } = data.data;
    
    return {
      url,
      title: title || null,
      description: description || null,
      image: image?.url || null,
      siteName: publisher || null,
      domain: extractDomain(url),
    };
  } catch (error) {
    console.error('Error fetching link preview:', error);
    return null;
  }
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