/**
 * Edge function `auth-password-hook` — Hook Supabase « Password Verification
 * Attempt ».
 * ======================================================================
 * BUT
 *   Re-limiter le brute-force de mot de passe sur le chemin qui CONTOURNE
 *   `auth-with-username` : un attaquant peut appeler GoTrue directement
 *   (`POST /auth/v1/token?grant_type=password`) avec la clé anon publique. Le
 *   rate-limit applicatif ne le voit pas. Ce hook, exécuté par GoTrue à CHAQUE
 *   tentative de connexion par mot de passe, limite par COMPTE (user_id) et par
 *   IP (`metadata.ip_address` fourni par GoTrue, sinon cf-connecting-ip).
 *
 * CONTRAT DU HOOK (source GoTrue)
 *   Entrée  : { "user_id": "<uuid>", "valid": <bool>,
 *               "metadata": { "ip_address": "<ip>", ... } }
 *   Sortie  : { "decision": "reject"|"continue", "message"?, "should_logout_user"? }
 *   GoTrue n'appelle ce hook que pour un utilisateur EXISTANT et le traite
 *   comme un point BLOQUANT : une erreur / un statut 5xx du hook fait ÉCHOUER
 *   la connexion. Le non-respect du Content-Type ou un corps vide échoue aussi.
 *
 * ⚠️ EXIGENCE FAIL-OPEN (sans risque de blocage total)
 *   Le hook ne doit JAMAIS bloquer tout le monde si sa logique/DB défaille.
 *   Règles appliquées :
 *     • mot de passe VALIDE (valid === true) → `continue` immédiat, SANS appel
 *       DB. On ne rejette jamais un mot de passe correct (anti-DoS, anti
 *       boucle de verrouillage d'un utilisateur légitime).
 *     • toute erreur interne (parse, DB, RPC indisponible, config manquante,
 *       signature invalide) → `continue` (200). JAMAIS `reject`, JAMAIS 5xx.
 *     • on ne renvoie `reject` QUE si le RPC répond explicitement allowed=false.
 *
 *   ⚠️ Limite résiduelle : si la fonction est SUPPRIMÉE ou INJOIGNABLE, GoTrue
 *   échoue (fail-closed) et bloque les connexions. Le « kill-switch » est de
 *   désactiver le hook côté config (voir rapport) — cf. étape 4 du rapport.
 *
 * SIGNATURE DU HOOK (optionnelle mais recommandée)
 *   GoTrue signe la requête « Standard Webhooks » (PAS un JWT) :
 *     webhook-id, webhook-timestamp, webhook-signature: v1,<base64(HMAC-SHA256)>
 *   Si `AUTH_PASSWORD_HOOK_SECRET` est défini, on vérifie la signature ; en cas
 *   d'échec on renvoie `continue` SANS toucher la DB (requête forgée inerte).
 *   Si le secret n'est pas défini, la vérification est ignorée (fail-open).
 * ======================================================================
 */

// ─── Configuration ────────────────────────────────────────────────────

/** Quotas par défaut (doivent correspondre aux DEFAULT du RPC). */
const LIMITS = {
    user: { max: 10, windowSec: 600 }, // 10 tentatives échouées / compte / 10 min
    ip: { max: 50, windowSec: 600 }    // 50 tentatives échouées / IP / 10 min
} as const;

const REJECT_MESSAGE = 'Trop de tentatives. Réessayez plus tard.';

/** Tolérance de fraîcheur de l'horodatage de signature (anti-rejeu). */
const SIGNATURE_MAX_SKEW_SECONDS = 300;

/** Nom de l'env var contenant le secret de signature (optionnel). */
const HOOK_SECRET_ENV = 'AUTH_PASSWORD_HOOK_SECRET';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Réponse JSON du hook. Toujours 200 + Content-Type application/json. */
function hookResponse(body: Record<string, unknown>): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
    });
}

/** Décision « continuer » (comportement GoTrue par défaut). */
function continueDecision(): Response {
    return hookResponse({ decision: 'continue' });
}

/** Hash SHA-256 hex d'une chaîne (anonymisation de l'IP avant stockage). */
async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Résout l'IP à limiter.
 * Priorité à `metadata.ip_address` : c'est l'IP que GoTrue a lui-même résolue
 * (via `Sb-Forwarded-For` côté plateforme, sinon X-Forwarded-For / RemoteAddr),
 * donc fiable. `cf-connecting-ip` est un repli (sur un appel serveur→fonction,
 * il peut refléter l'egress de GoTrue plutôt que le client). En dernier recours
 * 'unknown' : bucket commun (quota partagé, jamais illimité).
 */
function resolveIp(payload: { metadata?: { ip_address?: unknown } }, req: Request): string {
    const metaIp = payload?.metadata?.ip_address;
    if (typeof metaIp === 'string' && metaIp.trim().length > 0) return metaIp.trim();
    const cfIp = req.headers.get('cf-connecting-ip');
    if (cfIp && cfIp.trim().length > 0) return cfIp.trim();
    return 'unknown';
}

/** base64 → octets (pour la clé de signature). */
function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

/**
 * Extrait les clés de signature depuis la valeur de config
 * `hook_password_verification_attempt_secrets`. Format standard :
 * `v1,whsec_<base64>` (éventuellement plusieurs, séparés par des virgules).
 * On tolère aussi `whsec_<base64>` ou le base64 nu. Retourne les secrets
 * base64 (sans préfixe).
 */
function extractSigningSecrets(secretConfig: string): string[] {
    const secrets: string[] = [];
    const re = /v1,whsec_([A-Za-z0-9+/=]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(secretConfig)) !== null) secrets.push(m[1]);
    if (secrets.length === 0) {
        const s = secretConfig
            .trim()
            .replace(/^v1,/, '')
            .replace(/^whsec_/, '')
            .replace(/,+$/, '')
            .trim();
        if (s.length > 0) secrets.push(s);
    }
    return secrets;
}

/**
 * Vérifie la signature « Standard Webhooks » d'une requête de hook.
 * Retourne true si l'une des signatures fournies correspond à l'une des clés.
 */
async function verifyHookSignature(req: Request, rawBody: string, secretConfig: string): Promise<boolean> {
    const sigHeader = req.headers.get('webhook-signature');
    const msgId = req.headers.get('webhook-id');
    const tsHeader = req.headers.get('webhook-timestamp');
    if (!sigHeader || !msgId || !tsHeader) return false;

    const ts = Number(tsHeader);
    if (!Number.isFinite(ts)) return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > SIGNATURE_MAX_SKEW_SECONDS) return false;

    const signedContent = `${msgId}.${tsHeader}.${rawBody}`;

    for (const secret of extractSigningSecrets(secretConfig)) {
        try {
            const keyBytes = base64ToBytes(secret);
            if (keyBytes.length === 0) continue;
            const key = await crypto.subtle.importKey(
                'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
            );
            const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
            const expected = 'v1,' + btoa(String.fromCharCode(...new Uint8Array(mac)));
            // Le base64 ne contient ni espace ni virgule → containment sûr.
            if (sigHeader.includes(expected)) return true;
        } catch (e) {
            console.error('[password-hook] signature check error', e);
        }
    }
    return false;
}

// ─── Handler principal ────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
    // Seul POST est attendu (GoTrue). Tout autre appel ne doit rien casser.
    if (req.method !== 'POST') {
        return continueDecision();
    }

    try {
        // Corps brut (nécessaire pour la vérification de signature) puis JSON.
        const rawBody = await req.text();

        // Vérification de signature si un secret est configuré. En cas d'échec
        // on ne touche PAS la DB et on renvoie continue (requête forgée inerte).
        const hookSecret = Deno.env.get(HOOK_SECRET_ENV);
        if (hookSecret && hookSecret.trim().length > 0) {
            const ok = await verifyHookSignature(req, rawBody, hookSecret);
            if (!ok) {
                console.warn('[password-hook] invalid or missing webhook signature');
                return continueDecision();
            }
        }

        let payload: {
            user_id?: unknown;
            valid?: unknown;
            metadata?: { ip_address?: unknown };
        };
        try {
            payload = rawBody.length > 0 ? JSON.parse(rawBody) : {};
        } catch {
            // Payload illisible → on ne bloque pas.
            return continueDecision();
        }

        // Mot de passe VALIDE → jamais de rejet, aucun accès DB (anti-DoS).
        if (payload.valid === true) {
            return continueDecision();
        }

        const userId = typeof payload.user_id === 'string' && payload.user_id.trim().length > 0
            ? payload.user_id.trim()
            : null;
        const ip = resolveIp(payload, req);
        const ipKey = ip === 'unknown' ? 'unknown' : await sha256Hex(ip);

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceRoleKey) {
            // Config manquante → FAIL-OPEN.
            console.error('[password-hook] Supabase env manquant');
            return continueDecision();
        }

        const response = await fetch(
            `${supabaseUrl}/rest/v1/rpc/check_and_record_password_attempt`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${serviceRoleKey}`,
                    'apikey': serviceRoleKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    p_user: userId,
                    p_ip: ipKey,
                    p_user_max: LIMITS.user.max,
                    p_user_window_seconds: LIMITS.user.windowSec,
                    p_ip_max: LIMITS.ip.max,
                    p_ip_window_seconds: LIMITS.ip.windowSec
                })
            }
        );

        if (!response.ok) {
            // RPC indisponible → FAIL-OPEN (on NE bloque PAS tout le monde).
            console.error('[password-hook] RPC failed', response.status, await response.text());
            return continueDecision();
        }

        const rows = await response.json();
        const result = Array.isArray(rows) ? rows[0] : rows;
        if (result && result.allowed === false) {
            return hookResponse({
                decision: 'reject',
                message: REJECT_MESSAGE,
                // Ne PAS déconnecter les sessions existantes (anti-DoS).
                should_logout_user: false
            });
        }

        return continueDecision();

    } catch (error) {
        // Toute erreur inattendue → FAIL-OPEN. On ne bloque jamais par erreur.
        console.error('[password-hook] unexpected error', error);
        return continueDecision();
    }
});
