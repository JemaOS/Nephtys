/**
 * Edge function `anon-files-download`
 * ----------------------------------------------------------------------
 * Délivre des URLs SIGNÉES (courtes, 60 s) pour les chunks chiffrés du bucket
 * PRIVÉ `anon_files`, SANS jamais ré-introduire d'énumération.
 *
 * Contexte : le bucket `anon_files` est privé et sa policy SELECT bucket-wide a
 * été supprimée (migration 20261028_storage_anon_files_close_enumeration.sql).
 * Le téléchargement direct `supabase.storage.from('anon_files').download(path)`
 * échoue donc désormais pour tout le monde (deny by default). Le modèle de
 * confidentialité repose sur un PRÉFIXE ALÉATOIRE = capacité (type XFTP) :
 *   • le préfixe n'est rattaché à aucun owner (aucun scope SQL possible) ;
 *   • il est transmis hors-bande au pair via le canal privé chiffré.
 * Cette fonction ne LISTE rien : une URL n'est produite que pour un préfixe
 * EXACT fourni par l'appelant. Sans le préfixe, aucune découverte n'est possible.
 *
 * Route      : POST /functions/v1/anon-files-download
 * Auth       : JWT Supabase requis ET VÉRIFIÉ — rôles `authenticated`
 *              (utilisateur connecté, validé via GoTrue `auth.getUser`) OU
 *              `anon` (le jeton est comparé à la clé anon du projet
 *              `SUPABASE_ANON_KEY` : un JWT `anon` forgé ne peut pas la
 *              reproduire). Le rôle `service_role` et tout rôle inconnu sont
 *              refusés. La confidentialité NE repose PAS sur le rôle mais sur
 *              le préfixe aléatoire (capacité) : sans le préfixe exact, rien
 *              n'est découvrable.
 * Body JSON  : { "prefix": string, "chunks": number[] }
 *              ou { "prefix": string, "chunk": number } (un seul chunk).
 * Réponse    : 200 { "chunks": [{ "index": n, "url": "<signed-url>" }] }
 *              400 préfixe/index/corps invalide ; 401 rôle absent/invalide ;
 *              404 objet absent ; 405 méthode ; 429 rate-limit.
 *
 * SÉCURITÉ :
 *   • service_role UNIQUEMENT côté serveur (env SUPABASE_SERVICE_ROLE_KEY) pour
 *     `createSignedUrl(\`${prefix}/${i}\`, 60)` — la clé n'est jamais renvoyée ;
 *   • validation stricte (PREFIX_RE, index entiers bornés, ≤ 64 par appel) ;
 *   • rate-limit glissant : par utilisateur (role `authenticated`, vérifié via
 *     GoTrue) ou par IP vue par l'edge de confiance (`cf-connecting-ip`, role
 *     `anon`, clé publique partagée) ;
 *   • FAIL CLOSED : le moindre chunk absent ⇒ 404, aucune URL partielle.
 * ----------------------------------------------------------------------
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

/** Origines autorisées (CORS) — alignées sur les autres edge functions. */
const ALLOWED_ORIGINS = [
  'https://nephtys.jemaos.com',
  'https://www.nephtys.jemaos.com',
  'https://nephtys.app',
  'https://www.nephtys.app',
  'https://nephtys.vercel.app',
  'https://anu-nine.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
]

const BUCKET = 'anon_files'
/** Préfixe opaque autorisé : `[A-Za-z0-9_-]{8,}` (cf. PREFIX_RE client). */
const PREFIX_RE = /^[A-Za-z0-9_-]{8,}$/
/** Borne dure du nombre de chunks signés par appel (pagination côté client). */
const MAX_CHUNKS_PER_CALL = 64
/** Bornes d'index (exclusif) — cf. FILE_MAX_CHUNKS client. */
const MAX_INDEX_EXCLUSIVE = 100_000
/** Durée de vie de l'URL signée (secondes). */
const SIGNED_URL_TTL = 60
/** Rate-limit glissant par utilisateur : 120 appels / 60 s. */
const RATE_LIMIT_MAX = 120
const RATE_LIMIT_WINDOW_MS = 60_000

// ─── CORS ─────────────────────────────────────────────────────────────

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const safeOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'null'
  return {
    'Access-Control-Allow-Origin': safeOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'false',
    Vary: 'Origin',
  }
}

function json(
  body: unknown,
  status: number,
  cors: Record<string, string>,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', ...extraHeaders },
  })
}

// ─── Auth ─────────────────────────────────────────────────────────────

/** Décode le payload d'un JWT (base64url) sans vérifier la signature. Le rôle
 *  ainsi lu ne sert QU'À AIGUILLER le traitement : il n'est jamais cru en soi
 *  (chaque branche VÉRIFIE ensuite réellement le jeton — cf. handler). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const b64 = parts[1].replaceAll('-', '+').replaceAll('_', '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? ''
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
}

/** Comparaison de chaînes à temps constant (vérification de la clé anon). */
function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}

/**
 * IP du client telle que vue par l'edge de confiance.
 *
 * `cf-connecting-ip` est écrit par l'edge Cloudflare qui frontale Supabase :
 * sa valeur n'est PAS contrôlable par le client (Cloudflare (ré)écrit cet
 * en-tête sur le tronçon edge→origine). On l'utilise donc EXCLUSIVEMENT.
 *
 * On ne retombe PAS sur `x-forwarded-for` : sur les Edge Functions sa chaîne
 * est au mieux « best effort » et son DERNIER hop n'est PAS garanti non
 * forgeable (un client le ferait varier pour contourner le quota). En
 * l'absence d'en-tête de confiance on retourne 'unknown' (bucket commun, jamais
 * l'illimité). La valeur est hashée avant usage.
 */
function extractClientIp(req: Request): string {
  const cfIp = req.headers.get('cf-connecting-ip')
  if (cfIp && cfIp.trim().length > 0) return cfIp.trim()
  return 'unknown'
}

/** Hash SHA-256 (anonymise l'IP utilisée comme clé de rate-limit en mémoire). */
async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─── Rate limit (glissant, en mémoire, best effort par instance) ───────

const hits = new Map<string, number[]>()

function rateLimitExceeded(key: string): boolean {
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff)
  if (recent.length >= RATE_LIMIT_MAX) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  // Nettoyage opportuniste : évite la croissance non bornée sur instance longue.
  if (hits.size > 10_000) {
    for (const [k, v] of hits) {
      if (v.every((t) => t <= cutoff)) hits.delete(k)
    }
  }
  return false
}

// ─── Validation ───────────────────────────────────────────────────────

interface ParsedBody {
  prefix: string
  indices: number[]
}

/** Valide le corps et renvoie le préfixe + la liste d'index (dédupliquée). */
function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== 'object') throw new ValidationError('corps invalide')
  const raw = body as { prefix?: unknown; chunks?: unknown; chunk?: unknown }

  if (typeof raw.prefix !== 'string' || !PREFIX_RE.test(raw.prefix)) {
    throw new ValidationError('préfixe invalide')
  }

  const list: unknown[] = []
  if (raw.chunks !== undefined) {
    if (!Array.isArray(raw.chunks)) throw new ValidationError('`chunks` doit être un tableau')
    list.push(...raw.chunks)
  }
  if (raw.chunk !== undefined) list.push(raw.chunk)

  if (list.length === 0) throw new ValidationError('aucun chunk demandé')
  if (list.length > MAX_CHUNKS_PER_CALL) {
    throw new ValidationError(`trop de chunks (max ${MAX_CHUNKS_PER_CALL} par appel)`)
  }

  const seen = new Set<number>()
  const indices: number[] = []
  for (const value of list) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError('index non entier')
    }
    if (value < 0 || value >= MAX_INDEX_EXCLUSIVE) {
      throw new ValidationError('index hors bornes')
    }
    if (!seen.has(value)) {
      seen.add(value)
      indices.push(value)
    }
  }

  return { prefix: raw.prefix, indices }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req.headers.get('origin'))

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: cors })
  }
  if (req.method !== 'POST') {
    return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST uniquement.' } }, 405, cors)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRole) {
    // FAIL CLOSED : sans service_role, aucune URL signée ne peut être produite.
    return json({ error: { code: 'CONFIG_ERROR', message: 'Service indisponible.' } }, 500, cors)
  }

  // ── Authentification (JWT réellement VÉRIFIÉ : `authenticated` OU `anon`) ─
  const token = bearerToken(req)
  if (!token) {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Authentification requise.' } }, 401, cors)
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Le rôle lu dans le payload (non signé) ne sert qu'à AIGUILLER : chaque
  // branche VÉRIFIE ensuite réellement le jeton.
  //   • `authenticated` → validité/signature confirmées par GoTrue (getUser) ;
  //   • `anon`          → le jeton DOIT être EXACTEMENT la clé anon du projet
  //                       (`SUPABASE_ANON_KEY`) : un JWT `anon` forgé ne peut
  //                       pas reproduire cette chaîne ;
  //   • tout autre rôle (dont `service_role`) → refusé.
  const claims = decodeJwtPayload(token)
  const role = claims && typeof claims.role === 'string' ? claims.role : ''

  // ── Clé de rate-limit ─────────────────────────────────────────────────
  // authenticated → utilisateur vérifié via GoTrue (quota par compte).
  // anon          → clé publique partagée : quota par IP vue par l'edge.
  let rateLimitKey: string
  if (role === 'authenticated') {
    try {
      const { data, error } = await admin.auth.getUser(token)
      if (error || !data?.user) {
        return json({ error: { code: 'UNAUTHORIZED', message: 'Session invalide.' } }, 401, cors)
      }
      rateLimitKey = `user:${data.user.id}`
    } catch {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Session invalide.' } }, 401, cors)
    }
  } else if (role === 'anon') {
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!anonKey) {
      // FAIL CLOSED : sans clé anon de référence, aucun jeton `anon` n'est
      // vérifiable (le mode privé anonyme serait non authentifiable).
      console.error('[anon-files-download] SUPABASE_ANON_KEY manquant')
      return json({ error: { code: 'CONFIG_ERROR', message: 'Service indisponible.' } }, 500, cors)
    }
    if (!timingSafeEqual(token, anonKey)) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'Authentification requise.' } }, 401, cors)
    }
    rateLimitKey = `anon:${await sha256(extractClientIp(req))}`
  } else {
    return json({ error: { code: 'UNAUTHORIZED', message: 'Authentification requise.' } }, 401, cors)
  }

  // ── Rate-limit ────────────────────────────────────────────────────────
  if (rateLimitExceeded(rateLimitKey)) {
    return json(
      { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } },
      429,
      cors,
      { 'Retry-After': '60' },
    )
  }

  // ── Parse + validation ────────────────────────────────────────────────
  let parsed: ParsedBody
  try {
    parsed = parseBody(await req.json().catch(() => {
      throw new ValidationError('corps JSON invalide')
    }))
  } catch (error) {
    const message = error instanceof ValidationError ? error.message : 'corps invalide'
    return json({ error: { code: 'VALIDATION_ERROR', message } }, 400, cors)
  }

  // ── Signature des URLs (service_role, objets exacts uniquement) ───────
  const chunks: { index: number; url: string }[] = []
  for (const index of parsed.indices) {
    const { data, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(`${parsed.prefix}/${index}`, SIGNED_URL_TTL)

    if (error || !data?.signedUrl) {
      const msg = error?.message ?? ''
      const missing = /not found|does not exist|no such (file|object)/i.test(msg)
      // FAIL CLOSED : dès qu'un chunk manque, on abandonne (pas d'URL partielle).
      if (missing) {
        return json({ error: { code: 'NOT_FOUND', message: 'Chunk introuvable.' } }, 404, cors)
      }
      console.error('[anon-files-download] createSignedUrl failed:', msg)
      return json({ error: { code: 'STORAGE_ERROR', message: 'Erreur de stockage.' } }, 500, cors)
    }

    chunks.push({ index, url: data.signedUrl })
  }

  return json({ chunks }, 200, cors)
})
