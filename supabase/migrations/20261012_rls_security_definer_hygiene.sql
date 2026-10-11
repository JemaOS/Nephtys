-- ============================================================================
-- 20261012 — Hygiène SECURITY DEFINER (search_path + EXECUTE)
-- ============================================================================
-- Audit sécurité. Deux durcissements, idempotents et rétrocompatibles :
--
--   1. Toute fonction SECURITY DEFINER des schémas public/private qui n'a PAS
--      de `SET search_path` reçoit `SET search_path = pg_catalog, public, private`.
--      Sans cela, une fonction DEFINER peut être détournée via un search_path
--      contrôlé par l'appelant (création d'objets homonymes).
--
--   2. REVOKE EXECUTE ... FROM PUBLIC, anon sur les fonctions SECURITY DEFINER
--      qui n'en ont pas besoin, afin de fermer l'accès REST anonyme implicite.
--
-- Périmètre des REVOKE (volontairement conservateur, « ne rien casser ») :
--   • on ne touche PAS aux fonctions référencées par une policy RLS
--     (pg_depend → pg_policy) : le planner les évalue en tant qu'appelant ;
--     révoquer EXECUTE casserait alors les policies (régression connue) ;
--   • on ne touche PAS aux RPC du relais anonyme `anon_queue_*` (grantées
--     explicitement à `anon` — cf. 20261010_anon_queues.sql) ;
--   • on ne révoque JAMAIS `authenticated` (les RPC client nécessitent leurs
--     grants explicites ; on retire seulement l'accès implicite PUBLIC/anon).
--
-- Vérifié : les seuls RPC appelés par le client sont `get_user_conversations`
-- (granté à authenticated) et `anon_queue_*` (grantés à anon/authenticated).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) search_path par défaut sur les fonctions SECURITY DEFINER qui en manquent
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname                                  AS sch,
               p.proname                                  AS fn,
               pg_get_function_identity_arguments(p.oid)  AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private')
          AND p.prosecdef = true
          AND NOT EXISTS (
              SELECT 1
              FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
              WHERE cfg LIKE 'search_path=%'
          )
    LOOP
        BEGIN
            EXECUTE format(
                'ALTER FUNCTION %I.%I(%s) SET search_path = pg_catalog, public, private',
                r.sch, r.fn, r.args
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'search_path non appliqué à %.%(%) : %', r.sch, r.fn, r.args, SQLERRM;
        END;
    END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2) REVOKE EXECUTE (PUBLIC, anon) sur les fonctions DEFINER non nécessaires
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT n.nspname                                  AS sch,
               p.proname                                  AS fn,
               pg_get_function_identity_arguments(p.oid)  AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('public', 'private')
          AND p.prosecdef = true
          -- relais anonyme : doit rester appelable par anon
          AND p.proname NOT LIKE 'anon_queue_%'
          -- fonctions utilisées par une policy RLS : le planner doit pouvoir
          -- les exécuter en tant qu'appelant → on ne révoque pas
          AND NOT EXISTS (
              SELECT 1
              FROM pg_depend d
              WHERE d.refclassid = 'pg_proc'::regclass
                AND d.refobjid   = p.oid
                AND d.classid    = 'pg_policy'::regclass
          )
    LOOP
        BEGIN
            EXECUTE format(
                'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC, anon',
                r.sch, r.fn, r.args
            );
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'REVOKE non appliqué à %.%(%) : %', r.sch, r.fn, r.args, SQLERRM;
        END;
    END LOOP;
END
$mig$;
