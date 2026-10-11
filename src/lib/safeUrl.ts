// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

// Garde-fous d'URL : empêchent les schémas dangereux (javascript:, data:, vbscript:)
// d'être utilisés dans des href / window.open à partir de données contrôlées par
// un pair (link_preview, URLs de fichiers, etc.).

export function isSafeHttpUrl(u: unknown): boolean {
  if (typeof u !== 'string') return false
  const trimmed = u.trim()
  if (trimmed === '') return false
  // Rejette d'emblée les schémas dangereux même si le parseur les accepte.
  if (/^\s*(javascript|data|vbscript|file)\s*:/i.test(trimmed)) return false
  try {
    const base = typeof globalThis.location?.origin === 'string'
      ? globalThis.location.origin
      : 'https://localhost'
    const parsed = new URL(trimmed, base)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function safeHttpUrl(u: unknown): string | null {
  return isSafeHttpUrl(u) ? (u as string) : null
}

/**
 * Sources d'images/audio autorisées : http(s) (URL signées), blob: (objets
 * locaux) et data:image/ (rarement utilisé, mais inoffensif pour <img>).
 * Tout autre schéma (javascript:) est refusé.
 */
export function isSafeMediaSrc(u: unknown): boolean {
  if (typeof u !== 'string') return false
  const trimmed = u.trim()
  if (trimmed === '') return false
  if (/^\s*(javascript|vbscript|file)\s*:/i.test(trimmed)) return false
  if (/^\s*data:/i.test(trimmed)) return /^\s*data:image\//i.test(trimmed)
  if (/^\s*blob:/i.test(trimmed)) return true
  try {
    const base = typeof globalThis.location?.origin === 'string'
      ? globalThis.location.origin
      : 'https://localhost'
    const parsed = new URL(trimmed, base)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'blob:'
  } catch {
    return false
  }
}
