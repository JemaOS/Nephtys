-- =====================================================================
-- Anti-robot : suivi des ÉCHECS d'authentification pour déclencher un
-- CAPTCHA au-delà d'un seuil (edge function `auth-with-username`).
-- =====================================================================
-- Table dédiée (distincte de auth_rate_limits qui borne le débit brut) :
-- on n'enregistre ici QUE les échecs, afin que les connexions légitimes
-- répétées ne déclenchent pas de CAPTCHA.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.auth_login_failures (
    id BIGSERIAL PRIMARY KEY,
    -- 'ip' (hashée) ou 'username' (normalisé / canonique)
    key_type TEXT NOT NULL CHECK (key_type IN ('ip', 'username')),
    key_value TEXT NOT NULL,
    -- 'signup' ou 'signin'
    action TEXT NOT NULL CHECK (action IN ('signup', 'signin')),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_lookup
    ON public.auth_login_failures (key_type, key_value, action, attempted_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_login_failures_attempted_at
    ON public.auth_login_failures (attempted_at);

-- ─── Enregistrer un échec ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_auth_failure(
    p_key_type TEXT,
    p_key_value TEXT,
    p_action TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    INSERT INTO public.auth_login_failures (key_type, key_value, action)
    VALUES (p_key_type, p_key_value, p_action);
$$;

-- ─── Compter les échecs récents ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.count_auth_failures(
    p_key_type TEXT,
    p_key_value TEXT,
    p_action TEXT,
    p_window_seconds INT
)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COUNT(*)::INT
    FROM public.auth_login_failures
    WHERE key_type = p_key_type
      AND key_value = p_key_value
      AND action = p_action
      AND attempted_at > NOW() - (p_window_seconds || ' seconds')::INTERVAL;
$$;

-- ─── Effacer les échecs (après succès) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.clear_auth_failures(
    p_key_type TEXT,
    p_key_value TEXT,
    p_action TEXT
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    DELETE FROM public.auth_login_failures
    WHERE key_type = p_key_type
      AND key_value = p_key_value
      AND action = p_action;
$$;

-- ─── Purge utilitaire (> 24h) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_auth_login_failures()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM public.auth_login_failures
    WHERE attempted_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- ─── RLS : accessible uniquement via service_role ─────────────────────
ALTER TABLE public.auth_login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_login_failures FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_auth_failure(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_auth_failures(TEXT, TEXT, TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_auth_failures(TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_auth_login_failures() TO service_role;
