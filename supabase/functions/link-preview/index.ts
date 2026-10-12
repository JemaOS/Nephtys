/**
 * Edge function `link-preview`
 * ----------------------------------------------------------------------
 * Fetch des métadonnées Open Graph d'une URL côté serveur.
 *
 *   - Rapide : pas de tunnel via Microlink (souvent 3-8s, rate-limité)
 *   - Cas spécial YouTube : on utilise oEmbed (extrêmement rapide)
 *   - Cache DB : on stocke les previews dans `link_preview_cache`
 *     (TTL 7 jours) pour éviter de re-fetch les liens populaires
 *   - Timeout côté upstream : 4s max, sinon on retourne un fallback
 *   - CORS restreint aux mêmes origines que le reste de l'app
 *
 * ⚠️ Audit sécurité (attacker review, 2026-10-10) : `redirect: 'follow'`
 * permettait un SSRF par rebond (URL publique → redirection vers une IP
 * privée / 169.254.169.254). Le suivi de redirection est MANUEL et chaque saut
 * est revalidé, plafonné à MAX_REDIRECTS.
 *
 * ⚠️ Audit sécurité (2026-10-11) : durcissement du SSRF et de l'accès.
 *   1. La validation de l'hôte ne se limite PLUS au hostname littéral :
 *      - les formes d'IP non canoniques (0x7f000001, 0177.0.0.1, 127.1…)
 *        sont normalisées par le parseur WHATWG `URL`, puis rejetées ;
 *      - l'IPv6 est expansée et contrôlée (loopback, ULA, link-local,
 *        multicast, IPv4-mapped / -compatible / NAT64 / 6to4) ;
 *      - le host est RÉSOLU (DNS-over-HTTPS) et CHAQUE adresse retournée est
 *        vérifiée (loopback/privé/link-local/métadonnées) à CHAQUE saut.
 *   2. L'appelant doit être un utilisateur AUTHENTIFIÉ (JWT user vérifié via
 *      GoTrue). La clé anon (publique) et service_role sont refusées.
 *   3. Rate-limit glissant par utilisateur (anti-abus de fetch sortant).
 *
 * Limite résiduelle connue : la résolution DNS de contrôle et la résolution
 * faite par `fetch` sont deux requêtes distinctes (fenêtre TOCTOU / DNS
 * rebinding). Le pinning DNS n'étant pas exposé par `fetch`, le contrôle réduit
 * fortement la surface sans l'éliminer totalement (cf. rapport).
 * ----------------------------------------------------------------------
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = [
    'https://nephtys.jemaos.com',
    'https://www.nephtys.jemaos.com',
    'https://nephtys.app',
    'https://www.nephtys.app',
    'https://nephtys.vercel.app',
    'https://anu-nine.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
];

const CACHE_TTL_DAYS = 7;
const FETCH_TIMEOUT_MS = 4000;
const MAX_HTML_BYTES = 512 * 1024; // 512 KB suffisent largement pour le <head>
const MAX_REDIRECTS = 3;
/** Rate-limit glissant par utilisateur : 60 previews / 60 s. */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

interface LinkPreviewData {
    url: string;
    title: string | null;
    description: string | null;
    image: string | null;
    siteName: string | null;
    domain: string;
}

// ─── CORS ─────────────────────────────────────────────────────────────

function buildCorsHeaders(origin: string | null): HeadersInit {
    const safeOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
    return {
        'Access-Control-Allow-Origin': safeOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
    };
}

function jsonResponse(body: unknown, status: number, cors: HeadersInit, extra: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...(cors as Record<string, string>), 'Content-Type': 'application/json', ...extra },
    });
}

// ─── Auth ─────────────────────────────────────────────────────────────

function bearerToken(req: Request): string {
    const header = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
    return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

// ─── Rate limit (glissant, en mémoire, best effort par instance) ───────

const hits = new Map<string, number[]>();

function rateLimitExceeded(userId: string): boolean {
    const now = Date.now();
    const cutoff = now - RATE_LIMIT_WINDOW_MS;
    const recent = (hits.get(userId) ?? []).filter((t) => t > cutoff);
    if (recent.length >= RATE_LIMIT_MAX) {
        hits.set(userId, recent);
        return true;
    }
    recent.push(now);
    hits.set(userId, recent);
    // Nettoyage opportuniste : évite la croissance non bornée sur instance longue.
    if (hits.size > 10_000) {
        for (const [k, v] of hits) {
            if (v.every((t) => t <= cutoff)) hits.delete(k);
        }
    }
    return false;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractDomain(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
}

function isHttpUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/** Normalise le hostname : minuscules, sans point final (FQDN absolu). */
function normalizeHost(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
        return null;
    }
}

function isIpLiteral(host: string): boolean {
    if (host.startsWith('[') && host.endsWith(']')) return true; // IPv6 littérale
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

/** Vrai si l'IPv4 est loopback/privée/link-local/réservée/multicast. */
function isBlockedIpv4(ip: string): boolean {
    const p = ip.split('.').map((n) => Number(n));
    if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b, c] = p;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;      // 100.64.0.0/10 (CGNAT)
    if (a === 169 && b === 254) return true;                // 169.254.0.0/16 (link-local + métadonnées)
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true;       // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true;       // 192.0.2.0/24 (TEST-NET-1)
    if (a === 192 && b === 88 && c === 99) return true;     // 192.88.99.0/24 (6to4 relay)
    if (a === 192 && b === 168) return true;                // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true;   // 198.18.0.0/15 (benchmark)
    if (a === 198 && b === 51 && c === 100) return true;    // 198.51.100.0/24 (TEST-NET-2)
    if (a === 203 && b === 0 && c === 113) return true;     // 203.0.113.0/24 (TEST-NET-3)
    if (a >= 224) return true;                              // multicast (224/4) + réservé (240/4)
    return false;
}

/** Étend une IPv6 (éventuellement compressée + IPv4 finale) en 8 hextets. */
function parseIpv6(input: string): number[] | null {
    let s = input;
    if (s.includes('%')) return null; // zone id (eth0/…) non gérée ⇒ refus

    // IPv4 embarquée en fin d'adresse (ex: ::ffff:127.0.0.1)
    let tail: number[] = [];
    const m = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
    if (m) {
        const octets = m[1].split('.').map((n) => Number(n));
        if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        tail = [(octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]];
        s = s.slice(0, m.index);
        if (s.endsWith(':')) s = s.slice(0, -1);
    }

    const parseHextets = (str: string): number[] | null => {
        if (str === '') return [];
        const out: number[] = [];
        for (const part of str.split(':')) {
            if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
            out.push(Number.parseInt(part, 16));
        }
        return out;
    };

    let head: number[];
    let back: number[];
    let hasGap = false;
    const idx = s.indexOf('::');
    if (idx !== -1) {
        if (s.indexOf('::', idx + 2) !== -1) return null; // plus d'une compression
        hasGap = true;
        const h = parseHextets(s.slice(0, idx));
        const b = parseHextets(s.slice(idx + 2));
        if (h === null || b === null) return null;
        head = h;
        back = b;
    } else {
        const h = parseHextets(s);
        if (h === null) return null;
        head = h;
        back = [];
    }

    const fixed = head.length + back.length + tail.length;
    if (hasGap) {
        const missing = 8 - fixed;
        if (missing < 1) return null; // `::` doit représenter au moins un groupe
        return [...head, ...new Array(missing).fill(0), ...back, ...tail];
    }
    if (fixed !== 8) return null;
    return [...head, ...tail];
}

/** Extrait une IPv4 embarquée (mapped / compatible / NAT64 / 6to4), si présente. */
function extractEmbeddedIpv4(h: number[]): string | null {
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && (h[5] === 0 || h[5] === 0xffff)) {
        return v4(h[6], h[7]); // ::a.b.c.d / ::ffff:a.b.c.d
    }
    if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
        return v4(h[6], h[7]); // 64:ff9b::/96 (NAT64)
    }
    if (h[0] === 0x2002) {
        return v4(h[1], h[2]); // 2002::/16 (6to4)
    }
    return null;
}

/** Vrai si l'IPv6 est loopback/ULA/link-local/multicast/embarque une IPv4 interne. */
function isBlockedIpv6(ip: string): boolean {
    const h = parseIpv6(ip);
    if (!h) return true; // non parsable ⇒ bloqué (fail closed)
    if (h.every((x) => x === 0)) return true;                              // ::
    if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true;    // ::1
    if ((h[0] & 0xffc0) === 0xfe80) return true;                           // fe80::/10
    if ((h[0] & 0xfe00) === 0xfc00) return true;                           // fc00::/7 (ULA)
    if ((h[0] & 0xff00) === 0xff00) return true;                           // ff00::/8 (multicast)
    const embedded = extractEmbeddedIpv4(h);
    if (embedded) return isBlockedIpv4(embedded);
    return false;
}

function isBlockedIp(ip: string): boolean {
    const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
    return bare.includes(':') ? isBlockedIpv6(bare) : isBlockedIpv4(bare);
}

/**
 * Validation SYNCHRONE de l'hôte (sans DNS). Le parseur WHATWG `URL` normalise
 * déjà les formes d'IP non canoniques (0x7f000001, 0177.0.0.1, 127.1 → 127.0.0.1)
 * avant que l'on inspecte le hostname.
 */
function isSafeHostLiteral(url: string): boolean {
    const host = normalizeHost(url);
    if (!host) return false;

    if (host.startsWith('[') && host.endsWith(']')) return !isBlockedIp(host);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return !isBlockedIp(host);

    // Nom de domaine :
    if (host === 'localhost') return false;
    if (
        host.endsWith('.localhost') ||
        host.endsWith('.local') ||
        host.endsWith('.internal') ||
        host.endsWith('.home.arpa')
    ) {
        return false;
    }
    // Mono-label (sans point) : peut résoudre en interne (intranet, metadata…).
    if (!host.includes('.')) return false;
    // Caractères DNS plausibles uniquement.
    if (!/^[a-z0-9._-]+$/.test(host)) return false;
    return true;
}

// ─── Résolution DNS (DNS-over-HTTPS) + contrôle anti-rebinding ────────

interface DohAnswer {
    type: number;
    data: string;
}

/**
 * Interroge un résolveur DoH JSON (Cloudflare, puis Google en secours).
 * Renvoie la liste d'adresses, `[]` si NXDOMAIN, `null` si la résolution échoue.
 */
async function dohQuery(host: string, type: 'A' | 'AAAA', signal: AbortSignal): Promise<string[] | null> {
    const typeNum = type === 'A' ? 1 : 28;
    const endpoints = [
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        `https://dns.google/resolve?name=${encodeURIComponent(host)}&type=${type}`,
    ];
    for (const endpoint of endpoints) {
        try {
            const res = await fetch(endpoint, { signal, headers: { Accept: 'application/dns-json' } });
            if (!res.ok) continue;
            const data = (await res.json()) as { Status?: number; Answer?: DohAnswer[] };
            if (data.Status === 3) return []; // NXDOMAIN
            if (data.Status !== 0) continue;  // SERVFAIL/REFUSED → tente le suivant
            return (data.Answer ?? [])
                .filter((a) => a.type === typeNum)
                .map((a) => a.data.trim())
                .filter((a) => a.length > 0);
        } catch {
            // essaie le résolveur suivant
        }
    }
    return null;
}

async function resolveHostIps(host: string, signal: AbortSignal): Promise<string[] | null> {
    const [a, aaaa] = await Promise.all([
        dohQuery(host, 'A', signal),
        dohQuery(host, 'AAAA', signal),
    ]);
    if (a === null && aaaa === null) return null; // résolution impossible
    return [...(a ?? []), ...(aaaa ?? [])];
}

/**
 * Contrôle asynchrone : le host doit résoudre vers AU MOINS une adresse, et
 * TOUTES les adresses résolues doivent être publiques (fail closed).
 */
async function isHostSafeResolved(hostname: string, signal: AbortSignal): Promise<boolean> {
    if (isIpLiteral(hostname)) return true; // déjà contrôlé par isSafeHostLiteral
    const ips = await resolveHostIps(hostname, signal);
    if (ips === null || ips.length === 0) return false;
    return ips.every((ip) => !isBlockedIp(ip));
}

/** Normalise une URL pour servir de clé de cache stable. */
function canonicalize(url: string): string {
    try {
        const u = new URL(url);
        u.hash = '';
        const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref'];
        for (const p of trackingParams) u.searchParams.delete(p);
        return u.toString();
    } catch {
        return url;
    }
}

/** Décode les entités HTML les plus courantes. */
function decodeEntities(s: string): string {
    return s
        .replaceAll('&amp;', '&')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&#39;', "'")
        .replaceAll('&apos;', "'")
        .replaceAll(/&#(\d+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 10)))
        .replaceAll(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(Number.parseInt(n, 16)));
}

/** Cherche le contenu d'une meta tag par name|property. */
function findMeta(html: string, key: string): string | null {
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
    ];
    for (const re of patterns) {
        const m = re.exec(html);
        if (m && m[1]) return decodeEntities(m[1]).trim();
    }
    return null;
}

function findTitle(html: string): string | null {
    const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
    return m ? decodeEntities(m[1]).trim() : null;
}

function resolveImageUrl(image: string | null, baseUrl: string): string | null {
    if (!image) return null;
    try {
        return new URL(image, baseUrl).toString();
    } catch {
        return image;
    }
}

// ─── Fetch avec redirections validées (anti-SSRF) ─────────────────────

async function fetchSafe(url: string, signal: AbortSignal): Promise<Response | null> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!isHttpUrl(current) || !isSafeHostLiteral(current)) return null;
        const host = normalizeHost(current);
        // Résolution DNS + contrôle de CHAQUE adresse avant d'ouvrir la connexion.
        if (!host || !(await isHostSafeResolved(host, signal))) return null;
        const res = await fetch(current, {
            signal,
            redirect: 'manual',
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NephtysBot/1.0; +https://nephtys.app/bot)',
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en,fr;q=0.8',
            },
        });
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location');
            if (!loc) return null;
            let next: string;
            try {
                next = new URL(loc, current).toString();
            } catch {
                return null;
            }
            if (!isHttpUrl(next) || !isSafeHostLiteral(next)) return null; // revalidation du saut
            current = next;
            continue;
        }
        return res;
    }
    return null;
}

// ─── YouTube oEmbed (cas rapide) ──────────────────────────────────────

async function tryYouTubeOEmbed(url: string, signal: AbortSignal): Promise<LinkPreviewData | null> {
    try {
        const u = new URL(url);
        const isYouTube =
            u.hostname.endsWith('youtube.com') ||
            u.hostname.endsWith('youtu.be') ||
            u.hostname.endsWith('youtube-nocookie.com');
        if (!isYouTube) return null;

        const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
        const res = await fetch(oembed, {
            signal,
            headers: { Accept: 'application/json' },
        });
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

// ─── Generic OG fetch ─────────────────────────────────────────────────

async function fetchGenericPreview(url: string, signal: AbortSignal): Promise<LinkPreviewData | null> {
    try {
        const res = await fetchSafe(url, signal);
        if (!res || !res.ok) return null;
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('html')) return null;

        // Lecture limitée à MAX_HTML_BYTES
        const reader = res.body?.getReader();
        if (!reader) return null;
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let html = '';
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            html += decoder.decode(value, { stream: true });
            if (received >= MAX_HTML_BYTES || /<\/head>/i.test(html)) {
                try {
                    await reader.cancel();
                } catch {
                    // ignore
                }
                break;
            }
        }
        html += decoder.decode();

        const title = findMeta(html, 'og:title') || findMeta(html, 'twitter:title') || findTitle(html);
        const description =
            findMeta(html, 'og:description') ||
            findMeta(html, 'twitter:description') ||
            findMeta(html, 'description');
        const rawImage =
            findMeta(html, 'og:image') || findMeta(html, 'twitter:image') || findMeta(html, 'twitter:image:src');
        const siteName = findMeta(html, 'og:site_name') || findMeta(html, 'application-name');

        return {
            url,
            title: title || null,
            description: description || null,
            image: resolveImageUrl(rawImage, url),
            siteName: siteName || null,
            domain: extractDomain(url),
        };
    } catch {
        return null;
    }
}

// ─── Cache DB ─────────────────────────────────────────────────────────

interface CacheClient {
    get(url: string): Promise<LinkPreviewData | null>;
    set(url: string, data: LinkPreviewData): Promise<void>;
}

function makeCacheClient(): CacheClient | null {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return null;

    const restUrl = `${supabaseUrl}/rest/v1/link_preview_cache`;
    const headers = {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
    };

    return {
        async get(url) {
            try {
                const u = `${restUrl}?url=eq.${encodeURIComponent(url)}&select=*&limit=1`;
                const res = await fetch(u, { headers });
                if (!res.ok) return null;
                const rows = (await res.json()) as Array<{
                    url: string;
                    title: string | null;
                    description: string | null;
                    image: string | null;
                    site_name: string | null;
                    domain: string;
                    fetched_at: string;
                }>;
                if (rows.length === 0) return null;
                const row = rows[0];
                const ageMs = Date.now() - new Date(row.fetched_at).getTime();
                if (ageMs > CACHE_TTL_DAYS * 24 * 3600 * 1000) return null;
                return {
                    url: row.url,
                    title: row.title,
                    description: row.description,
                    image: row.image,
                    siteName: row.site_name,
                    domain: row.domain,
                };
            } catch {
                return null;
            }
        },
        async set(url, data) {
            try {
                await fetch(restUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        url,
                        title: data.title,
                        description: data.description,
                        image: data.image,
                        site_name: data.siteName,
                        domain: data.domain,
                        fetched_at: new Date().toISOString(),
                    }),
                });
            } catch {
                // best effort
            }
        },
    };
}

// ─── Handler ──────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    const origin = req.headers.get('origin');
    const cors = buildCorsHeaders(origin);

    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: cors });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405, cors);
    }

    // ── Configuration
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRole) {
        console.error('[link-preview] configuration Supabase manquante');
        return jsonResponse({ error: 'Service unavailable' }, 500, cors);
    }

    // ── Authentification : JWT utilisateur OBLIGATOIRE (pas anon/service)
    // `getUser` n'accepte qu'un JWT porteur d'un utilisateur (`sub`) : la clé
    // anon (publique) et la clé service_role sont dépourvues de `sub` et
    // échouent ici → AUCUN chemin anonyme n'existe (vérifié : le seul appelant
    // réseau autorisé ensuite est l'anti-SSRF ci-dessous). Le repli anon client
    // (linkPreview.ts) aboutit donc à un 401 et bascule sur oEmbed navigateur.
    const token = bearerToken(req);
    if (!token) {
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Authentification requise.' } }, 401, cors);
    }
    let userId: string;
    try {
        const admin = createClient(supabaseUrl, serviceRole, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await admin.auth.getUser(token);
        if (error || !data?.user) {
            return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Session invalide.' } }, 401, cors);
        }
        userId = data.user.id;
    } catch {
        return jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Session invalide.' } }, 401, cors);
    }

    // ── Rate-limit par utilisateur
    if (rateLimitExceeded(userId)) {
        return jsonResponse(
            { error: { code: 'RATE_LIMITED', message: 'Trop de requêtes.' } },
            429,
            cors,
            { 'Retry-After': '60' },
        );
    }

    // ── Parse + validation
    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse({ error: 'Invalid JSON' }, 400, cors);
    }

    const rawUrl = (body.url || '').trim();
    if (!rawUrl || !isHttpUrl(rawUrl) || !isSafeHostLiteral(rawUrl)) {
        return jsonResponse({ error: 'Invalid URL' }, 400, cors);
    }

    const url = canonicalize(rawUrl);

    // 1) Cache lookup
    const cache = makeCacheClient();
    if (cache) {
        const cached = await cache.get(url);
        if (cached) {
            return jsonResponse({ data: cached, cached: true }, 200, cors);
        }
    }

    // 2) Fetch upstream avec timeout strict (résolution DNS contrôlée par saut)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let preview: LinkPreviewData | null = null;
    try {
        preview = (await tryYouTubeOEmbed(url, controller.signal)) ?? (await fetchGenericPreview(url, controller.signal));
    } finally {
        clearTimeout(timer);
    }

    if (!preview) {
        preview = {
            url,
            title: null,
            description: null,
            image: null,
            siteName: null,
            domain: extractDomain(url),
        };
    }

    // 3) Stockage en cache (best effort)
    if (cache && preview.title) {
        await cache.set(url, preview);
    }

    return jsonResponse({ data: preview, cached: false }, 200, cors);
});
