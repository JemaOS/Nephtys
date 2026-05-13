// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { resolveMediaUrl, extractStoragePath } from '@/lib/mediaUrl'
import { fetchAndDecryptMedia } from '@/lib/encryptedMediaService'

/**
 * Helper centralisé pour télécharger un média (image, vidéo, audio, fichier)
 * de manière fiable et avec un retour utilisateur en cas d'erreur.
 *
 * Cas gérés :
 *  1. URL signée déjà résolue → fetch direct
 *  2. Path storage nu (`groups/abc/file.jpg`) → re-signe puis fetch
 *  3. Média chiffré E2EE → utilise fetchAndDecryptMedia (déchiffre avant DL)
 *  4. URL externe (http/https vers gif/sticker giphy etc.) → fetch direct
 *  5. Blob/data URL → use direct
 *
 * Renvoie `true` en cas de succès, `false` sinon (et affiche une alerte).
 *
 * Avant ce helper, les boutons "Télécharger" du MediaViewer / context menu
 * faisaient juste `fetch(mediaUrl)` ce qui échouait silencieusement quand :
 *  - L'URL était un path nu (le composant l'avait reçu sans signing)
 *  - La signed URL était expirée
 *  - Le média était chiffré (le fetch renvoyait du binaire chiffré inutile)
 * et l'utilisateur ne voyait rien — juste un console.error invisible.
 */
export interface DownloadMediaOptions {
  /** URL ou path du média */
  mediaUrl: string
  /** Nom de fichier suggéré (sans extension, ou avec) */
  fileName?: string | null
  /** Type de média pour inférer l'extension si fileName manque */
  mediaType?: 'image' | 'video' | 'audio' | 'gif' | 'sticker' | 'file' | string
  /** Si chiffré E2EE, on a besoin du messageId + userId pour déchiffrer */
  messageId?: string
  userId?: string
  isEncrypted?: boolean
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/m4a': 'm4a',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/json': 'json',
  'text/plain': 'txt',
}

const TYPE_TO_DEFAULT_EXT: Record<string, string> = {
  image: 'jpg',
  video: 'mp4',
  audio: 'webm',
  gif: 'gif',
  sticker: 'webp',
  file: 'bin',
}

// Content-Types qui indiquent un mauvais étiquetage par le serveur (Supabase
// Storage renvoie souvent `application/octet-stream` ou `text/plain` quand le
// mime n'a pas été défini lors de l'upload). On les ignore au profit du
// mediaType explicite ou de l'extension extraite de l'URL.
const UNRELIABLE_CONTENT_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'text/plain',
  'application/x-empty',
])

const TYPE_FAMILY_FROM_MEDIATYPE: Record<string, 'image' | 'video' | 'audio' | undefined> = {
  image: 'image',
  gif: 'image',
  sticker: 'image',
  video: 'video',
  audio: 'audio',
}

function isContentTypeReliable(blobType: string, mediaType: string | undefined): boolean {
  if (UNRELIABLE_CONTENT_TYPES.has(blobType)) return false
  if (!mediaType) return true
  // Si on connaît le mediaType (image / video / audio), on n'accepte le
  // Content-Type que s'il appartient à la même famille. Empêche un
  // text/plain, application/json ou autre erreur serveur de produire un .txt
  // pour une image qu'on sait être une image.
  const family = TYPE_FAMILY_FROM_MEDIATYPE[mediaType]
  if (!family) return true
  return blobType.startsWith(`${family}/`)
}

function extractExtFromUrl(mediaUrl: string): string | null {
  // Strip querystring puis prend le segment final pour ne PAS matcher des
  // points dans les paramètres (`?token=abc.def.ghi` notamment dans les
  // signed URLs Supabase, JWT-like).
  const noQuery = mediaUrl.split('?')[0].split('#')[0]
  const lastSlash = noQuery.lastIndexOf('/')
  const lastSegment = lastSlash >= 0 ? noQuery.slice(lastSlash + 1) : noQuery
  const dotIdx = lastSegment.lastIndexOf('.')
  if (dotIdx <= 0 || dotIdx >= lastSegment.length - 1) return null
  const ext = lastSegment.slice(dotIdx + 1).toLowerCase()
  // Ne garder que des extensions plausibles (alphanum, 2-5 chars)
  if (!/^[a-z0-9]{2,5}$/.test(ext)) return null
  return ext
}

function inferExtension(
  blobType: string,
  fileName: string | null | undefined,
  mediaUrl: string,
  mediaType: string | undefined
): string {
  // 1. Si fileName a déjà une extension, la garder
  if (fileName) {
    const dotIdx = fileName.lastIndexOf('.')
    if (dotIdx > 0 && dotIdx < fileName.length - 1) {
      return '' // Le nom complet sera utilisé tel quel
    }
  }
  // 2. Inférer depuis Content-Type — uniquement si fiable et cohérent avec
  // le mediaType déclaré (évite text/plain → .txt sur une image).
  if (isContentTypeReliable(blobType, mediaType) && MIME_TO_EXT[blobType]) {
    return MIME_TO_EXT[blobType]
  }
  // 3. Inférer depuis l'URL/path (en ignorant la querystring)
  const urlExt = extractExtFromUrl(mediaUrl)
  if (urlExt) {
    return urlExt
  }
  // 4. Fallback sur le mediaType
  if (mediaType && TYPE_TO_DEFAULT_EXT[mediaType]) {
    return TYPE_TO_DEFAULT_EXT[mediaType]
  }
  // 5. Dernier recours : Content-Type même non-fiable, plutôt que .bin
  if (blobType && MIME_TO_EXT[blobType]) {
    return MIME_TO_EXT[blobType]
  }
  return 'bin'
}

function buildFileName(
  fileName: string | null | undefined,
  ext: string,
  mediaType: string | undefined
): string {
  if (fileName) {
    // fileName complet avec extension → on l'utilise tel quel
    if (ext === '') return fileName
    return `${fileName}.${ext}`
  }
  const prefix = mediaType || 'media'
  return `${prefix}-${Date.now()}.${ext}`
}

async function fetchAsBlob(url: string): Promise<Blob> {
  const response = await fetch(url, {
    // Important : pas de credentials (les signed URLs Supabase utilisent
    // un token dans la querystring, pas de cookies). credentials='omit'
    // évite des problèmes CORS sur certaines configurations.
    credentials: 'omit',
    // Cache normal — si le navigateur a déjà l'image en cache via
    // <img src>, on la récupère sans re-fetch réseau.
    cache: 'force-cache',
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`)
  }
  return response.blob()
}

/**
 * Télécharge le média et déclenche la sauvegarde dans le navigateur.
 * @returns true en cas de succès, false sinon
 */
export async function downloadMedia(opts: DownloadMediaOptions): Promise<boolean> {
  const { mediaUrl, fileName, mediaType, messageId, userId, isEncrypted } = opts

  if (!mediaUrl) {
    alert('❌ Aucun média à télécharger')
    return false
  }

  let blob: Blob
  try {
    if (isEncrypted) {
      // Média chiffré E2EE : on récupère un blob URL via le service de
      // déchiffrement, puis on fetch ce blob (le blob est déjà déchiffré).
      if (!messageId || !userId) {
        throw new Error('messageId/userId requis pour déchiffrer le média')
      }
      const path = extractStoragePath(mediaUrl) || mediaUrl
      const decryptedBlobUrl = await fetchAndDecryptMedia(messageId, path, userId)
      blob = await fetchAsBlob(decryptedBlobUrl)
    } else if (mediaUrl.startsWith('blob:') || mediaUrl.startsWith('data:')) {
      // Blob/data URL déjà local
      blob = await fetchAsBlob(mediaUrl)
    } else if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) {
      // URL absolue : pourrait être une signed URL valide, ou bien une URL
      // expirée — dans le doute on essaie d'abord le fetch direct, et si ça
      // échoue avec 400/403, on retente après re-signing du path extrait.
      try {
        blob = await fetchAsBlob(mediaUrl)
      } catch (e) {
        const path = extractStoragePath(mediaUrl)
        if (path) {
          const freshUrl = await resolveMediaUrl(path)
          if (!freshUrl) throw e
          blob = await fetchAsBlob(freshUrl)
        } else {
          throw e
        }
      }
    } else {
      // Path storage nu : il faut le signer
      const signed = await resolveMediaUrl(mediaUrl)
      if (!signed) {
        throw new Error('Impossible de signer l\'URL du média')
      }
      blob = await fetchAsBlob(signed)
    }
  } catch (err) {
    console.error('[downloadMedia] Failed to fetch media:', err)
    const message = err instanceof Error ? err.message : String(err)
    alert(`❌ Échec du téléchargement\n${message}`)
    return false
  }

  // Déclenche le download
  try {
    const ext = inferExtension(blob.type, fileName, mediaUrl, mediaType)
    const downloadName = buildFileName(fileName, ext, mediaType)
    const objectUrl = globalThis.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = downloadName
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    // On laisse 1s avant de révoquer pour que le navigateur ait le temps
    // de déclencher le download (sur Safari/iOS notamment).
    setTimeout(() => globalThis.URL.revokeObjectURL(objectUrl), 1000)
    return true
  } catch (err) {
    console.error('[downloadMedia] Failed to trigger save:', err)
    alert('❌ Le navigateur a refusé de télécharger le fichier')
    return false
  }
}
