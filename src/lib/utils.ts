// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { clsx, ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function cleanLinkPreviewContent(content: string, url: string): string {
  // First remove the URL
  const cleaned = content.replace(url, '');
  
  // Manual trim of punctuation and whitespace to avoid Regex DoS
  let start = 0;
  let end = cleaned.length;
  const chars = new Set([' ', '\t', '\n', '\r', '-', '–', '—', ':']);
  
  while (start < end && chars.has(cleaned[start])) {
    start++;
  }
  
  while (end > start && chars.has(cleaned[end - 1])) {
    end--;
  }
  
  return cleaned.slice(start, end);
}
