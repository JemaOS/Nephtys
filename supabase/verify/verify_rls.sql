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
