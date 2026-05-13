-- =====================================================================
-- Anti-DDoS / Anti-flood : table de rate limiting pour les inscriptions
-- =====================================================================
-- Cette table est utilisée par l'edge function `auth-with-username`
-- pour limiter les inscriptions abusives par IP et par username.
-- Elle est volontairement stockée côté DB (et non en mémoire) car les
-- edge functions Deno sont stateless / multi-instances.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    id BIGSERIAL PRIMARY KEY,
    -- Type d'identifiant : 'ip' ou 'username'
    key_type TEXT NOT NULL CHECK (key_type IN ('ip', 'username')),
    -- Valeur (adresse IP hashée ou username normalisé)
    key_value TEXT NOT NULL,
    -- Action surveillée : 'signup' ou 'signin'
    action TEXT NOT NULL CHECK (action IN ('signup', 'signin')),
    -- Horodatage de la tentative
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Statut : succès ou échec (utile pour analyse a posteriori)
    success BOOLEAN NOT NULL DEFAULT FALSE
);

-- Index composite pour les requêtes de comptage rapide
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_lookup
    ON public.auth_rate_limits (key_type, key_value, action, attempted_at DESC);

-- Index pour la purge des vieux enregistrements
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_attempted_at
    ON public.auth_rate_limits (attempted_at);

-- =====================================================================
-- Fonction RPC : check_and_record_rate_limit
-- Atomiquement :
--  1. Compte les tentatives sur la fenêtre glissante
--  2. Si sous la limite → enregistre la tentative et renvoie allowed=true
--  3. Sinon renvoie allowed=false avec retry_after
-- =====================================================================
CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit(
    p_key_type TEXT,
    p_key_value TEXT,
    p_action TEXT,
    p_max_attempts INT,
    p_window_seconds INT
)
RETURNS TABLE(allowed BOOLEAN, current_count INT, retry_after_seconds INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INT;
    v_oldest TIMESTAMPTZ;
    v_window_start TIMESTAMPTZ;
BEGIN
    v_window_start := NOW() - (p_window_seconds || ' seconds')::INTERVAL;

    -- Compter les tentatives dans la fenêtre
    SELECT COUNT(*), MIN(attempted_at)
    INTO v_count, v_oldest
    FROM public.auth_rate_limits
    WHERE key_type = p_key_type
      AND key_value = p_key_value
      AND action = p_action
      AND attempted_at > v_window_start;

    IF v_count >= p_max_attempts THEN
        -- Bloqué : on calcule le temps avant que la plus vieille tentative sorte de la fenêtre
        RETURN QUERY SELECT
            FALSE,
            v_count,
            GREATEST(1, EXTRACT(EPOCH FROM (v_oldest + (p_window_seconds || ' seconds')::INTERVAL - NOW()))::INT);
        RETURN;
    END IF;

    -- Autorisé : on enregistre la tentative
    INSERT INTO public.auth_rate_limits (key_type, key_value, action)
    VALUES (p_key_type, p_key_value, p_action);

    RETURN QUERY SELECT TRUE, v_count + 1, 0;
END;
$$;

-- =====================================================================
-- Fonction utilitaire : purge des entrées de plus de 24h
-- À appeler via un cron Supabase (pg_cron) ou manuellement.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.purge_auth_rate_limits()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted INT;
BEGIN
    DELETE FROM public.auth_rate_limits
    WHERE attempted_at < NOW() - INTERVAL '24 hours';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- =====================================================================
-- RLS : table accessible uniquement via service_role / SECURITY DEFINER
-- =====================================================================
ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;

-- Aucune politique pour anon/authenticated → accès interdit par défaut
-- Les edge functions utilisent service_role qui bypasse RLS.

-- Permissions explicites
REVOKE ALL ON public.auth_rate_limits FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_rate_limit(TEXT, TEXT, TEXT, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_auth_rate_limits() TO service_role;
