-- ============================================================================
-- Vérification RLS & intégrité d'accès — À EXÉCUTER SUR LA BASE DÉPLOYÉE
-- ============================================================================
-- Lecture seule (aucune modification). Exécution :
--   npx supabase@latest db query --linked --file supabase/verify/verify_rls.sql
-- ou via l'éditeur SQL du dashboard.
--
-- IMPORTANT (leçon apprise) : un privilège de TABLE prime sur un privilège de
-- COLONNE. `REVOKE SELECT (col) ... FROM role` est SANS EFFET si le rôle
-- possède encore `SELECT` au niveau table. Pour retirer une colonne, il faut
-- révoquer le SELECT de table PUIS regranter les colonnes autorisées.
-- ============================================================================

-- 1) Policies permissives résiduelles sur des tableaux sensibles.
--    (profiles USING(true) est attendu — discovery — mais voir requête 4.)
SELECT schemaname, tablename, policyname, roles::text AS roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (qual = 'true' OR with_check = 'true')
  AND 'authenticated' = ANY (roles)
ORDER BY tablename, policyname;

-- 2) Policies lisibles par `public`/`anon` (non connecté) : doit être 0 ligne
--    sur les tables sensibles. Toute ligne = donnée exposée sans authentification.
SELECT tablename, policyname, roles::text AS roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND roles && ARRAY['anon', 'public']::name[]
ORDER BY tablename, policyname;

-- 3) RLS activée sur toutes les tables publiques (relrowsecurity = true).
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity ASC, c.relname;

-- 4) Exposition des colonnes sensibles de `profiles` (le vrai enjeu).
--    DOIVENT ÊTRE `false` pour anon : encrypted_private_key, x25519_private_key,
--    ratchet_keys_encrypted, password_hash.
SELECT
  has_table_privilege('anon','public.profiles','SELECT')                            AS anon_table_select,
  has_column_privilege('anon','public.profiles','encrypted_private_key','SELECT')  AS anon_read_privkey,
  has_column_privilege('anon','public.profiles','x25519_private_key','SELECT')     AS anon_read_x25519,
  has_column_privilege('anon','public.profiles','password_hash','SELECT')          AS anon_read_pwhash,
  -- Pour `authenticated` : true = un compte connecté peut lire les clés
  -- privées chiffrées de N'IMPORTE QUEL utilisateur (RLS au niveau ligne).
  -- À corriger via RPC owner-only + révocation des colonnes (plan séparé).
  has_column_privilege('authenticated','public.profiles','x25519_private_key','SELECT') AS auth_read_x25519,
  has_column_privilege('authenticated','public.profiles','ratchet_keys_encrypted','SELECT') AS auth_read_ratchet;

-- 5) one_time_prekeys : la policy UPDATE ne doit exposer que la consommation.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'one_time_prekeys'
ORDER BY policyname;

-- 6) Test REST anonyme (à lancer hors SQL, avec la clé anon) :
--      curl "https://<ref>.supabase.co/rest/v1/profiles?select=encrypted_private_key&limit=1" \
--        -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--    → DOIT renvoyer 401 "permission denied for table profiles".
-- ============================================================================

-- ============================================================================
-- 7) Vérifications des correctifs 20261012_rls_* (à exécuter après application)
-- ============================================================================

-- 7a) one_time_prekeys : plus de policy UPDATE large + RPC de consommation.
--     Attendu : PAS de ligne `otpk_update_consume` ; une policy owner
--     (`otpk_update_own`) peut subsister.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'one_time_prekeys'
ORDER BY policyname;

-- RPC atomique : SECURITY DEFINER, search_path défini, non exécutable par anon.
SELECT p.proname,
       p.prosecdef                                   AS security_definer,
       p.proconfig                                    AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'consume_one_time_prekey';

-- 7b) conversations / conversation_members : policies UPDATE resserrées.
--     Attendu : conversations = créateur/admin uniquement ;
--               conversation_members = self/admin/créateur uniquement.
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('conversations', 'conversation_members')
  AND cmd = 'UPDATE'
ORDER BY tablename, policyname;

-- 7c) profiles SELECT : doit référencer `discoverable`.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT';

-- 7d) documents (si présent) : RLS activée et 0 policy large.
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'documents';

SELECT policyname, cmd, roles::text AS roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'documents';

-- 7e) can_access_media : SECURITY INVOKER (prosecdef=false), plus d'EXECUTE
--     pour anon ni authenticated.
SELECT p.proname,
       p.prosecdef AS security_definer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'can_access_media';

-- 7f) Hygiène SECURITY DEFINER : fonctions DEFINER sans search_path.
--     Attendu : 0 ligne (hors éventuelles fonctions d'extensions).
SELECT n.nspname AS schema, p.proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public', 'private')
  AND p.prosecdef = true
  AND NOT EXISTS (
      SELECT 1 FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
      WHERE cfg LIKE 'search_path=%'
  )
ORDER BY n.nspname, p.proname;
-- ============================================================================
