-- ============================================================================
-- 20261039 — Hook « password verification attempt » : table + RPC dédiés
-- ============================================================================
-- CONTEXTE
--   Le rate-limit applicatif (edge function `auth-with-username`) n'est PAS
--   appliqué si l'attaquant appelle DIRECTEMENT GoTrue
--   (`POST /auth/v1/token?grant_type=password`) avec la clé anon publique. Le
--   seul moyen de re-limiter ce chemin est le hook Supabase « Password
--   Verification Attempt » (Teams/Enterprise), exécuté par GoTrue à CHAQUE
--   tentative de connexion par mot de passe. Il renvoie
--   `{"decision":"reject"}` pour bloquer, `{"decision":"continue"}` sinon.
--
--   Ce hook tourne SANS authentification utilisateur et GoTrue le traite comme
--   un point bloquant : une erreur/5xx du hook fait ÉCHOUER la connexion. On
--   stocke donc l'état de limitation côté DB (les Edge Functions Deno sont
--   stateless/multi-instances) et le hook est écrit en FAIL-OPEN.
--
-- OBJECTIF
--   1. Table dédiée `auth_password_attempts` (même pattern que
--      `auth_rate_limits` : comptage sur fenêtre glissante), séparée pour ne
--      PAS re-toucher les CHECK élargis de `auth_rate_limits` (20261030).
--   2. RPC atomique `check_and_record_password_attempt(p_user, p_ip)` :
--      sérialise par clé via pg_advisory_xact_lock, compte les tentatives
--      échouées sur la fenêtre, renvoie allowed=false dès qu'UN des deux axes
--      (compte OU IP) dépasse son quota, sinon enregistre la tentative.
--      SECURITY DEFINER, réservée au service_role (appelée par la Edge
--      Function en service role).
--
--   Cette migration est purement ADDITIVE (aucune table/policy existante
--   modifiée). Elle est idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table : tentatives de mot de passe (une ligne par dimension enregistrée)
-- ---------------------------------------------------------------------------
-- key_type='user' : key_value = user_id (UUID fourni par le hook)
-- key_type='ip'   : key_value = IP hashée (SHA-256) ou 'unknown' (cf. hook)
-- Une tentative ÉCHOUÉE écrit 2 lignes (une 'user', une 'ip'). Les tentatives
-- bloquées ne sont PAS enregistrées → la fenêtre glisse et le blocage expire
-- naturellement (pas de verrouillage auto-prolongé).
CREATE TABLE IF NOT EXISTS public.auth_password_attempts (
    id BIGSERIAL PRIMARY KEY,
    key_type TEXT NOT NULL CHECK (key_type IN ('user', 'ip')),
    key_value TEXT NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index pour le comptage par clé sur fenêtre (lookup DESC sur attempted_at).
CREATE INDEX IF NOT EXISTS idx_auth_password_attempts_lookup
    ON public.auth_password_attempts (key_type, key_value, attempted_at DESC);

-- Index pour la purge des vieux enregistrements.
CREATE INDEX IF NOT EXISTS idx_auth_password_attempts_attempted_at
    ON public.auth_password_attempts (attempted_at);

-- ---------------------------------------------------------------------------
-- RPC : check_and_record_password_attempt
-- ---------------------------------------------------------------------------
-- Atomiquement (verrous + comptage + insertion dans la MÊME transaction) :
--   1. Verrouille les deux clés (ordre déterministe user→ip : pas de deadlock)
--   2. Compte les tentatives échouées dans la fenêtre de chaque axe
--   3. Si l'un dépasse son quota → allowed=false + retry_after (max des deux)
--   4. Sinon enregistre (user + ip) et renvoie allowed=true
--
-- Quotas par défaut : 10 tentatives échouées / 10 min par compte,
-- 50 / 10 min par IP. Surchargeables par paramètre (tests / ajustements).
-- p_user / p_ip NULL ou vide → la dimension correspondante est ignorée.
CREATE OR REPLACE FUNCTION public.check_and_record_password_attempt(
    p_user TEXT,
    p_ip TEXT,
    p_user_max INT DEFAULT 10,
    p_user_window_seconds INT DEFAULT 600,
    p_ip_max INT DEFAULT 50,
    p_ip_window_seconds INT DEFAULT 600
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INT, user_count INT, ip_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_user_count INT := 0;
    v_ip_count   INT := 0;
    v_user_oldest TIMESTAMPTZ;
    v_ip_oldest   TIMESTAMPTZ;
    v_user_retry  INT := 0;
    v_ip_retry    INT := 0;
    v_has_user BOOLEAN := (p_user IS NOT NULL AND length(p_user) > 0);
    v_has_ip   BOOLEAN := (p_ip   IS NOT NULL AND length(p_ip)   > 0);
BEGIN
    -- Rien à limiter : autoriser.
    IF NOT v_has_user AND NOT v_has_ip THEN
        RETURN QUERY SELECT TRUE, 0, 0, 0;
        RETURN;
    END IF;

    -- Verrous transactionnels dans un ordre GLOBAL déterministe (toujours
    -- user avant ip) : toutes les transactions prennent les verrous dans le
    -- même ordre → aucun cycle de blocage possible (pas de deadlock), et les
    -- appels concurrents sur une même clé sont sérialisés (pas de course).
    IF v_has_user THEN
        PERFORM pg_advisory_xact_lock(hashtext('pw_user|' || p_user));
    END IF;
    IF v_has_ip THEN
        PERFORM pg_advisory_xact_lock(hashtext('pw_ip|' || p_ip));
    END IF;

    -- Comptage sur fenêtre glissante — axe compte.
    IF v_has_user THEN
        SELECT COUNT(*), MIN(attempted_at)
        INTO v_user_count, v_user_oldest
        FROM public.auth_password_attempts
        WHERE key_type = 'user'
          AND key_value = p_user
          AND attempted_at > NOW() - (p_user_window_seconds || ' seconds')::INTERVAL;
    END IF;

    -- Comptage sur fenêtre glissante — axe IP.
    IF v_has_ip THEN
        SELECT COUNT(*), MIN(attempted_at)
        INTO v_ip_count, v_ip_oldest
        FROM public.auth_password_attempts
        WHERE key_type = 'ip'
          AND key_value = p_ip
          AND attempted_at > NOW() - (p_ip_window_seconds || ' seconds')::INTERVAL;
    END IF;

    -- Délai avant sortie de la plus vieille tentative (par axe dépassé).
    IF v_has_user AND v_user_count >= p_user_max THEN
        v_user_retry := GREATEST(1, EXTRACT(EPOCH FROM (v_user_oldest + (p_user_window_seconds || ' seconds')::INTERVAL - NOW()))::INT);
    END IF;
    IF v_has_ip AND v_ip_count >= p_ip_max THEN
        v_ip_retry := GREATEST(1, EXTRACT(EPOCH FROM (v_ip_oldest + (p_ip_window_seconds || ' seconds')::INTERVAL - NOW()))::INT);
    END IF;

    IF v_user_retry > 0 OR v_ip_retry > 0 THEN
        -- Bloqué : on n'enregistre PAS (le blocage expire sans être prolongé).
        RETURN QUERY SELECT FALSE, GREATEST(v_user_retry, v_ip_retry), v_user_count, v_ip_count;
        RETURN;
    END IF;

    -- Autorisé : on enregistre la tentative sur chaque dimension suivie.
    INSERT INTO public.auth_password_attempts (key_type, key_value)
    SELECT 'user', p_user WHERE v_has_user;
    INSERT INTO public.auth_password_attempts (key_type, key_value)
    SELECT 'ip', p_ip WHERE v_has_ip;

    RETURN QUERY SELECT
        TRUE,
        0,
        v_user_count + (CASE WHEN v_has_user THEN 1 ELSE 0 END),
        v_ip_count   + (CASE WHEN v_has_ip   THEN 1 ELSE 0 END);
END;
$fn$;

COMMENT ON FUNCTION public.check_and_record_password_attempt(TEXT, TEXT, INT, INT, INT, INT) IS
    'Rate-limit du hook password_verification_attempt. Atomique (advisory locks user→ip), compte les échecs par compte et par IP sur fenêtre glissante. Renvoie allowed=false si l''un des quotas est dépassé. service_role uniquement.';

-- ---------------------------------------------------------------------------
-- Purge (mêmes conventions que purge_auth_rate_limits)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_auth_password_attempts()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM public.auth_password_attempts
    WHERE attempted_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS + permissions : accès réservé au service_role
-- ---------------------------------------------------------------------------
ALTER TABLE public.auth_password_attempts ENABLE ROW LEVEL SECURITY;
-- Aucune policy anon/authenticated → accès refusé par défaut (service_role
-- bypasse RLS ; les RPC SECURITY DEFINER s'exécutent avec les droits du
-- propriétaire).
REVOKE ALL ON public.auth_password_attempts FROM anon, authenticated;

REVOKE ALL ON FUNCTION public.check_and_record_password_attempt(TEXT, TEXT, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_password_attempt(TEXT, TEXT, INT, INT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION public.purge_auth_password_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_auth_password_attempts() TO service_role;
