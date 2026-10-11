-- ============================================================================
-- 2026-10-30 — Correctifs d'audit (final) : fonctions (items #3, #4, #8)
-- ============================================================================
-- Item #3 (volet fonction) : le RPC `public.exec_sql(text)` a été utilisé par
--   les edge functions « temp » pour injecter des policies Storage arbitraires.
--   Il n'a AUCUN appelant légitime → on le supprime (toutes signatures).
--
-- Item #4 : `anon_queue_create()` (20261010_anon_queue_hardening.sql) insère
--   dans `auth_rate_limits` avec key_type='anon', action='anon_queue_create'.
--   Or les CHECK de 20260513_create_auth_rate_limits.sql n'autorisent que
--   key_type IN ('ip','username') et action IN ('signup','signin') → l'INSERT
--   échoue et `anon_queue_create` est CASSÉ.
--   Choix : ÉLARGIR les CHECK (sur-ensemble) — cela débloque l'insertion SANS
--   affaiblir le rate-limit auth (les valeurs 'ip'/'username'/'signup'/'signin'
--   restent valides, aucune contrainte n'est retirée).
--
-- Item #8 : `check_and_record_rate_limit` comptait puis insérait sans
--   sérialisation → des appels concurrents sur la même clé pouvaient dépasser
--   la limite (course). On sérialise par clé via
--   pg_advisory_xact_lock(hashtext(key_type||key_value||action)) AVANT le
--   comptage/insertion. Le verrou est transactionnel (relâché au COMMIT).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- #3 — suppression de exec_sql (toutes signatures, schéma public)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.exec_sql(text);
DROP FUNCTION IF EXISTS public.exec_sql(text, jsonb);
DROP FUNCTION IF EXISTS public.exec_sql(text, json);

DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname                                   AS sch,
               p.proname                                   AS fn,
               pg_get_function_identity_arguments(p.oid)   AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'exec_sql'
    LOOP
        EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s)', r.sch, r.fn, r.args);
    END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- #4 — auth_rate_limits : élargir les CHECK (idempotent)
-- ---------------------------------------------------------------------------
-- 1) Retirer toute contrainte CHECK existante portant sur key_type / action
--    (nom auto `auth_rate_limits_key_type_check` / `_action_check` ou autre).
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel     ON rel.oid = con.conrelid
        JOIN pg_namespace n   ON n.oid   = rel.relnamespace
        WHERE n.nspname = 'public'
          AND rel.relname = 'auth_rate_limits'
          AND con.contype = 'c'
          AND (
              pg_get_constraintdef(con.oid) ILIKE '%key_type%'
              OR pg_get_constraintdef(con.oid) ILIKE '%action%'
          )
    LOOP
        EXECUTE format('ALTER TABLE public.auth_rate_limits DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;
END
$mig$;

-- 2) Recréer les CHECK élargis (sur-ensemble des valeurs historiques).
ALTER TABLE public.auth_rate_limits
    DROP CONSTRAINT IF EXISTS auth_rate_limits_key_type_check;
ALTER TABLE public.auth_rate_limits
    ADD CONSTRAINT auth_rate_limits_key_type_check
    CHECK (key_type IN ('ip', 'username', 'anon'));

ALTER TABLE public.auth_rate_limits
    DROP CONSTRAINT IF EXISTS auth_rate_limits_action_check;
ALTER TABLE public.auth_rate_limits
    ADD CONSTRAINT auth_rate_limits_action_check
    CHECK (action IN ('signup', 'signin', 'anon_queue_create'));

-- ---------------------------------------------------------------------------
-- #8 — check_and_record_rate_limit : sérialisation par clé (anti-course)
-- ---------------------------------------------------------------------------
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
AS $function$
DECLARE
    v_count INT;
    v_oldest TIMESTAMPTZ;
    v_window_start TIMESTAMPTZ;
    v_lock_key BIGINT;
BEGIN
    -- Verrou transactionnel par (type|valeur|action) : sérialise les appels
    -- concurrents sur la même clé → plus de dépassement de limite par course.
    v_lock_key := hashtext(p_key_type || '|' || p_key_value || '|' || p_action);
    PERFORM pg_advisory_xact_lock(v_lock_key);

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
        -- Bloqué : temps avant que la plus vieille tentative sorte de la fenêtre
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
$function$;

-- CREATE OR REPLACE conserve l'ACL existante (service_role only), on la réaffirme
-- par sécurité en cas de run partiel.
REVOKE ALL ON FUNCTION public.check_and_record_rate_limit(TEXT, TEXT, TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_rate_limit(TEXT, TEXT, TEXT, INT, INT) TO service_role;
