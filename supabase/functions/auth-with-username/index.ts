/**
 * Edge function `auth-with-username`
 * ----------------------------------------------------------------------
 * Authentification par pseudo (signup / signin) avec protection
 * anti-DDoS / anti-flood multi-couches :
 *
 *   1. Validation stricte des entrées (longueur, regex)
 *   2. Rate limiting par IP (3 signups / heure, 10 signins / 5 min)
 *   3. Rate limiting par username (5 signins / 15 min)
 *   4. CORS restreint aux origines autorisées
 *   5. Hash des IPs avant stockage (RGPD)
 *
 * Toutes les vérifications sont effectuées AVANT tout appel à
 * l'API admin Supabase, ce qui évite la création massive de comptes
 * et la saturation du serveur.
 * ----------------------------------------------------------------------
 */

// ─── Configuration ────────────────────────────────────────────────────

/** Origines autorisées (CORS). Adapter à votre domaine de production. */
const ALLOWED_ORIGINS = [
    'https://nephtys.app',
    'https://www.nephtys.app',
    'https://nephtys.vercel.app',
    'https://anu-nine.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000'
];

/** Rate limits — fenêtre glissante par action. */
const RATE_LIMITS = {
    signup: {
        ip: { max: 3, windowSec: 3600 },        // 3 inscriptions / IP / heure
        username: { max: 1, windowSec: 60 }      // 1 tentative / username / minute
    },
    signin: {
        ip: { max: 10, windowSec: 300 },         // 10 connexions / IP / 5 min
        username: { max: 5, windowSec: 900 }     // 5 tentatives / username / 15 min
    }
} as const;

/** Validation des entrées. */
const VALIDATION = {
    username: {
        minLength: 3,
        maxLength: 20,
        // Lettres, chiffres, underscore, tiret. Pas d'espaces ni d'unicode exotique.
        regex: /^[a-zA-Z0-9_-]+$/
    },
    password: {
        minLength: 8,
        maxLength: 128
    }
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────

/** Construit les headers CORS selon l'origine du requêteur. */
function buildCorsHeaders(origin: string | null): Record<string, string> {
    const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Allow-Credentials': 'false',
        'Vary': 'Origin'
    };
}

/** Récupère l'IP du client via les headers Vercel/Supabase. */
function extractClientIp(req: Request): string {
    const headers = req.headers;
    const candidates = [
        headers.get('cf-connecting-ip'),
        headers.get('x-real-ip'),
        headers.get('x-forwarded-for')?.split(',')[0]?.trim(),
        headers.get('x-client-ip')
    ];
    for (const candidate of candidates) {
        if (candidate && candidate.length > 0) return candidate;
    }
    return 'unknown';
}

/** Hash SHA-256 d'une chaîne (pour anonymiser les IPs en base). */
async function sha256(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Réponse JSON standardisée. */
function jsonResponse(body: unknown, status: number, corsHeaders: Record<string, string>) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
}

/** Valide les entrées utilisateur. Lance une Error si invalide. */
function validateInput(action: string, username: unknown, password: unknown): { username: string; password: string; action: 'signup' | 'signin' } {
    if (action !== 'signup' && action !== 'signin') {
        throw new ValidationError('Action invalide.');
    }
    if (typeof username !== 'string' || typeof password !== 'string') {
        throw new ValidationError('Username et password doivent être des chaînes.');
    }

    const u = username.trim();
    if (u.length < VALIDATION.username.minLength || u.length > VALIDATION.username.maxLength) {
        throw new ValidationError(`Le pseudo doit faire entre ${VALIDATION.username.minLength} et ${VALIDATION.username.maxLength} caractères.`);
    }
    if (!VALIDATION.username.regex.test(u)) {
        throw new ValidationError('Le pseudo ne peut contenir que des lettres, chiffres, _ et -.');
    }

    // Validation longueur password : stricte pour signup (anti-flood),
    // permissive pour signin (rétrocompat avec anciens comptes).
    if (password.length < 1 || password.length > VALIDATION.password.maxLength) {
        throw new ValidationError('Mot de passe invalide.');
    }
    if (action === 'signup' && password.length < VALIDATION.password.minLength) {
        throw new ValidationError(`Le mot de passe doit faire au moins ${VALIDATION.password.minLength} caractères.`);
    }

    return { action, username: u, password };
}

class ValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
    }
}

class RateLimitError extends Error {
    retryAfter: number;
    constructor(message: string, retryAfter: number) {
        super(message);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}

/**
 * Vérifie ET enregistre une tentative en une seule requête atomique côté DB.
 * Lance RateLimitError si la limite est dépassée.
 */
async function enforceRateLimit(
    supabaseUrl: string,
    serviceRoleKey: string,
    keyType: 'ip' | 'username',
    keyValue: string,
    action: 'signup' | 'signin',
    max: number,
    windowSec: number
): Promise<void> {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_record_rate_limit`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${serviceRoleKey}`,
            'apikey': serviceRoleKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            p_key_type: keyType,
            p_key_value: keyValue,
            p_action: action,
            p_max_attempts: max,
            p_window_seconds: windowSec
        })
    });

    if (!response.ok) {
        // En cas d'échec du RPC, on FAIL OPEN (laisse passer) pour ne pas bloquer
        // les utilisateurs légitimes en cas de souci DB. À monitorer.
        console.error('[RateLimit] RPC check failed', await response.text());
        return;
    }

    const rows = await response.json();
    const result = Array.isArray(rows) ? rows[0] : rows;
    if (!result?.allowed) {
        throw new RateLimitError(
            `Trop de tentatives. Réessayez dans ${result?.retry_after_seconds ?? 60}s.`,
            result?.retry_after_seconds ?? 60
        );
    }
}

// ─── Handler principal ────────────────────────────────────────────────

Deno.serve(async (req) => {
    const origin = req.headers.get('origin');
    const corsHeaders = buildCorsHeaders(origin);

    if (req.method === 'OPTIONS') {
        return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== 'POST') {
        return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST uniquement.' } }, 405, corsHeaders);
    }

    try {
        // ── Parse + validation
        let body: { action?: string; username?: string; password?: string };
        try {
            body = await req.json();
        } catch {
            throw new ValidationError('Corps JSON invalide.');
        }

        const { action, username, password } = validateInput(
            body.action ?? '',
            body.username,
            body.password
        );

        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        if (!serviceRoleKey || !supabaseUrl) {
            console.error('[Auth] Configuration Supabase manquante');
            return jsonResponse(
                { error: { code: 'CONFIG_ERROR', message: 'Service indisponible.' } },
                503,
                corsHeaders
            );
        }

        // ── Rate limiting (IP puis username)
        const clientIp = extractClientIp(req);
        const ipKey = await sha256(clientIp);
        const usernameKey = username.toLowerCase();

        const limits = RATE_LIMITS[action];
        await enforceRateLimit(supabaseUrl, serviceRoleKey, 'ip', ipKey, action, limits.ip.max, limits.ip.windowSec);
        await enforceRateLimit(supabaseUrl, serviceRoleKey, 'username', usernameKey, action, limits.username.max, limits.username.windowSec);

        // ── Génération email interne
        const sanitizedUsername = username.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
        const email = `${sanitizedUsername}@nephtys.internal`;

        if (action === 'signup') {
            // Création utilisateur via API admin
            const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email,
                    password,
                    email_confirm: true,
                    user_metadata: { username }
                })
            });

            if (!createUserResponse.ok) {
                const errorData = await createUserResponse.json().catch(() => ({}));
                throw new Error(errorData.msg || errorData.error_description || 'Erreur création utilisateur');
            }

            const userData = await createUserResponse.json();
            const userId = userData.id;

            // Création profil
            const sessionId = `${username}-${Date.now()}`;
            const insertProfileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=minimal'
                },
                body: JSON.stringify({
                    id: userId,
                    username,
                    display_name: username,
                    session_id: sessionId
                })
            });

            if (!insertProfileResponse.ok) {
                const errorText = await insertProfileResponse.text();
                // Rollback : supprimer l'user créé pour éviter les comptes orphelins
                await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${serviceRoleKey}`,
                        'apikey': serviceRoleKey
                    }
                }).catch(() => { /* best effort */ });
                throw new Error(`Erreur création profil: ${errorText}`);
            }

            // Connexion immédiate pour obtenir une session
            const signInResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            if (!signInResponse.ok) {
                const errorData = await signInResponse.json().catch(() => ({}));
                throw new Error(errorData.msg || 'Erreur connexion après inscription');
            }

            const sessionData = await signInResponse.json();
            return jsonResponse(
                { data: { session: sessionData, user: userData } },
                200,
                corsHeaders
            );
        }

        // action === 'signin'
        const signInResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: 'POST',
            headers: {
                'apikey': serviceRoleKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        if (!signInResponse.ok) {
            const errorData = await signInResponse.json().catch(() => ({}));
            throw new Error(errorData.error_description || errorData.msg || 'Identifiants invalides');
        }

        const sessionData = await signInResponse.json();
        return jsonResponse({ data: { session: sessionData } }, 200, corsHeaders);

    } catch (error) {
        if (error instanceof RateLimitError) {
            return new Response(
                JSON.stringify({
                    error: { code: 'RATE_LIMITED', message: error.message }
                }),
                {
                    status: 429,
                    headers: {
                        ...corsHeaders,
                        'Content-Type': 'application/json',
                        'Retry-After': String(error.retryAfter)
                    }
                }
            );
        }

        if (error instanceof ValidationError) {
            return jsonResponse(
                { error: { code: 'VALIDATION_ERROR', message: error.message } },
                400,
                corsHeaders
            );
        }

        console.error('[Auth] Erreur:', error);
        return jsonResponse(
            {
                error: {
                    code: 'AUTH_ERROR',
                    message: (error as Error)?.message ?? 'Erreur inconnue.'
                }
            },
            400,
            corsHeaders
        );
    }
});
