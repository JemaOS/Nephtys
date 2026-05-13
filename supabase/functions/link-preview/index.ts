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
 * ----------------------------------------------------------------------
 */

const ALLOWED_ORIGINS = [
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

/** Bloque les hôtes privés / loopback pour éviter SSRF. */
function isSafeHost(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return false;
        if (host.endsWith('.local') || host.endsWith('.internal')) return false;
        // IPs privées simples (IPv4)
        if (/^10\./.test(host)) return false;
        if (/^192\.168\./.test(host)) return false;
        if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
        if (/^169\.254\./.test(host)) return false;
        return true;
    } catch {
        return false;
    }
}

/** Normalise une URL pour servir de clé de cache stable. */
function canonicalize(url: string): string {
    try {
        const u = new URL(url);
        u.hash = '';
        // Retirer les paramètres de tracking courants
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
    // <meta property="og:title" content="..." />  (ordre property/content variable)
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
        const res = await fetch(url, {
            signal,
            redirect: 'follow',
            headers: {
                // User-agent qui sert généralement les meta OG (sites comme Twitter
                // n'envoient le head que pour des UA réputés)
                'User-Agent':
                    'Mozilla/5.0 (compatible; NephtysBot/1.0; +https://nephtys.app/bot)',
                Accept: 'text/html,application/xhtml+xml',
                'Accept-Language': 'en,fr;q=0.8',
            },
        });

        if (!res.ok) return null;
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
            // On peut s'arrêter dès qu'on a vu </head> ou qu'on a atteint la limite
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
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    let body: { url?: string };
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    const rawUrl = (body.url || '').trim();
    if (!rawUrl || !isHttpUrl(rawUrl) || !isSafeHost(rawUrl)) {
        return new Response(JSON.stringify({ error: 'Invalid URL' }), {
            status: 400,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    const url = canonicalize(rawUrl);

    // 1) Cache lookup
    const cache = makeCacheClient();
    if (cache) {
        const cached = await cache.get(url);
        if (cached) {
            return new Response(JSON.stringify({ data: cached, cached: true }), {
                headers: { ...cors, 'Content-Type': 'application/json' },
            });
        }
    }

    // 2) Fetch upstream avec timeout strict
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let preview: LinkPreviewData | null = null;
    try {
        preview = (await tryYouTubeOEmbed(url, controller.signal)) ?? (await fetchGenericPreview(url, controller.signal));
    } finally {
        clearTimeout(timer);
    }

    if (!preview) {
        // Fallback minimal pour qu'au moins le domaine s'affiche tout de suite
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

    return new Response(JSON.stringify({ data: preview, cached: false }), {
        headers: { ...cors, 'Content-Type': 'application/json' },
    });
});
