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
-- 8) Vérifications des correctifs 20261030_audit_final (à exécuter après)
-- ============================================================================

-- 8a) HISTORIQUE (état 20261030, superseded par §12/20261041) :
--     conversation_members INSERT devait alors n'avoir AUCUNE branche
--     `user_id = auth.uid()`. Ce n'est PLUS l'état attendu : la branche
--     d'auto-insertion est RÉ-AUTORISÉE légitimement (cf. §12). Requêtes
--     conservées à titre informatif ; l'état ATTENDU est celui de §12.
SELECT policyname, cmd, roles::text AS roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
ORDER BY policyname;

-- Auto-insertion (self) : DÉSORMAIS ATTENDU 1 ligne `cm_insert_creator_or_admin`
-- (voir §12 pour le contrôle complet). N'est plus un « résidu interdit ».
SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
  AND with_check ILIKE '%user_id = auth.uid()%'
ORDER BY policyname;

-- 8b) conversations INSERT : UNE seule policy, `conv_insert_creator`, sans
--     branche `created_by IS NULL`. ATTENDU : 1 ligne, 0 sans auth.uid().
SELECT policyname, cmd, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversations'
  AND cmd = 'INSERT'
ORDER BY policyname;

SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversations'
  AND cmd = 'INSERT'
  AND with_check NOT ILIKE '%auth.uid()%'
ORDER BY policyname;

-- 8c) profiles : plus de policy INSERT pour anon, et anon ne détient AUCUN
--     privilège d'écriture. ATTENDU : 0 ligne anon ; les 3 booléens = false.
SELECT policyname, cmd, roles::text AS roles
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
  AND roles && ARRAY['anon', 'public']::name[]
ORDER BY policyname;

SELECT has_table_privilege('anon','public.profiles','INSERT') AS anon_insert,
       has_table_privilege('anon','public.profiles','UPDATE') AS anon_update,
       has_table_privilege('anon','public.profiles','DELETE') AS anon_delete;

-- 8d) Trigger message : la denylist doit couvrir les nouveaux champs.
--     ATTENDU : `prosrc` contient chacun des identifiants listés (true x9).
SELECT
  position('sender_sealed'        in prosrc) > 0 AS has_sender_sealed,
  position('sender_name'          in prosrc) > 0 AS has_sender_name,
  position('sender_avatar'        in prosrc) > 0 AS has_sender_avatar,
  position('NEW.profiles'         in prosrc) > 0 AS has_profiles,
  position('reply_to_id'          in prosrc) > 0 AS has_reply_to_id,
  position('NEW.type'             in prosrc) > 0 AS has_type,
  position('is_ephemeral'         in prosrc) > 0 AS has_is_ephemeral,
  position('ephemeral_duration'   in prosrc) > 0 AS has_ephemeral_duration,
  position('ephemeral_expires_at' in prosrc) > 0 AS has_ephemeral_expires_at
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'restrict_member_message_update';

-- 8e) profiles : colonnes de clés privées ABSENTES.
--     ATTENDU : 0 ligne.
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
  AND column_name IN (
    'x25519_private_key','x25519_salt','x25519_iv',
    'ratchet_keys_encrypted','ratchet_keys_salt','ratchet_keys_iv',
    'encrypted_private_key','private_key_salt','private_key_iv','password_hash'
  )
ORDER BY column_name;

-- 8f) auth_rate_limits : CHECK élargis (anon + anon_queue_create).
--     ATTENDU : les deux définitions contiennent 'anon' / 'anon_queue_create'.
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class rel   ON rel.oid = con.conrelid
JOIN pg_namespace n ON n.oid   = rel.relnamespace
WHERE n.nspname = 'public' AND rel.relname = 'auth_rate_limits' AND con.contype = 'c'
ORDER BY con.conname;

-- 8g) exec_sql : SUPPRIMÉ. ATTENDU : 0 ligne.
SELECT n.nspname AS schema, p.proname, pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname = 'exec_sql'
ORDER BY n.nspname;

-- 8h) check_and_record_rate_limit : sérialisation par clé présente.
--     ATTENDU : has_advisory_lock = true.
SELECT position('pg_advisory_xact_lock' in prosrc) > 0 AS has_advisory_lock
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'check_and_record_rate_limit';

-- ============================================================================
-- 9) Vérifications des correctifs 20261036 (items #1, #3, #4)
-- ============================================================================

-- 9a) conversation_members INSERT : UNE seule policy `cm_insert_creator_or_admin`.
--     (20261041 a AJOUTÉ la branche self `user_id = auth.uid()` — voir §12.
--     Il n'existe toujours AUCUNE branche « membre quelconque ». )
--     ATTENDU : 1 ligne ; la requête suivante (« is_conversation_member » seul)
--     doit renvoyer 0 ligne (un membre quelconque ne peut PAS insérer un tiers).
SELECT policyname, cmd, roles::text AS roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
ORDER BY policyname;

SELECT policyname, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
  AND with_check ILIKE '%is_conversation_member%'
ORDER BY policyname;

-- 9a-bis) Trigger BEFORE INSERT qui force le rôle : ATTENDU 1 ligne + true.
SELECT tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'conversation_members'
  AND NOT t.tgisinternal
  AND tgname = 'trg_cm_force_member_role';

SELECT position('NEW.role := ''member''' in prosrc) > 0 AS forces_member_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'force_member_role_on_insert';

-- 9a-ter) Conversation non créateur sans rôle admin : la policy admin/owner
--     helper doit exister et être exécutable par authenticated.
SELECT p.proname,
       p.prosecdef                                                AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'is_conversation_admin';

-- 9b) one_time_prekeys SELECT : owner-only.
--     ATTENDU : 1 ligne `otpk_select_own` (qual = user_id = auth.uid()) ;
--     la 2e requête (lecture `is_used = false` d'autrui) = 0 ligne.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'one_time_prekeys'
  AND cmd = 'SELECT'
ORDER BY policyname;

SELECT policyname, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'one_time_prekeys'
  AND cmd = 'SELECT'
  AND qual ILIKE '%is_used%'
ORDER BY policyname;

-- 9b-bis) RPC de revendication atomique d'une OPK d'un pair.
--     ATTENDU : security_definer = true, anon_can_execute = false,
--               auth_can_execute = true.
SELECT p.proname,
       p.prosecdef                                                AS security_definer,
       p.proconfig                                                AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'claim_one_time_prekey';

-- 9c) Denylist UPDATE `messages` : les 4 colonnes ajoutées (item #4) doivent
--     être présentes. ATTENDU : les 4 booléens = true.
SELECT
  position('NEW.created_at' in prosrc) > 0 AS has_created_at,
  position('NEW.updated_at' in prosrc) > 0 AS has_updated_at,
  position('NEW.is_starred' in prosrc) > 0 AS has_is_starred,
  position('NEW.is_pinned'  in prosrc) > 0 AS has_is_pinned
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'restrict_member_message_update';

-- ============================================================================
-- 10) Vérifications du correctif 20261037_enforce_aal2 (à exécuter après)
-- ============================================================================

-- 10a) Helpers aal2 : SECURITY DEFINER, search_path défini, non exécutables
--      par anon, exécutables par authenticated (requis pour l'évaluation RLS).
--      ATTENDU : 2 lignes ; security_definer = true ; anon_can_execute = false ;
--                auth_can_execute = true ; settings contient 'search_path='.
SELECT p.proname,
       p.prosecdef                                                AS security_definer,
       p.proconfig                                                AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname IN ('requires_aal2', 'aal2_ok')
ORDER BY p.proname;

-- 10b) CŒUR DU CONTRÔLE : chaque policy sensible gatée doit référencer
--      `aal2_ok` (dans USING ou WITH CHECK).
--      ATTENDU : toutes les lignes ont has_aal2_ok = true (0 ligne à false).
SELECT tablename, policyname, cmd,
       (COALESCE(qual, '') ILIKE '%aal2_ok%'
        OR COALESCE(with_check, '') ILIKE '%aal2_ok%') AS has_aal2_ok
FROM pg_policies
WHERE schemaname = 'public'
  AND (
        (tablename = 'messages'
           AND policyname IN ('msg_select_member','msg_insert_sender_member',
                              'messages_update_member','msg_delete_sender'))
     OR (tablename = 'message_text_keys'
           AND policyname IN ('mtk_select_recipient','mtk_insert_sender','mtk_delete_sender'))
     OR (tablename = 'message_media_keys'
           AND policyname IN ('mmk_select_recipient','mmk_insert_sender','mmk_delete_sender'))
     OR (tablename = 'conversations'
           AND policyname IN ('conv_select_member','conv_insert_creator',
                              'conv_update_admin_or_creator','conv_delete_creator'))
     OR (tablename = 'conversation_members'
           AND policyname IN ('cm_select_member','cm_insert_creator_or_admin',
                              'cm_update_self_or_admin',
                              'cm_delete_self_or_creator','cm_delete_own_or_admin'))
     OR (tablename = 'profiles'
           AND policyname = 'profiles_select_discoverable_or_related')
  )
ORDER BY tablename, policyname;

-- 10c) Résidu : polices sensibles `authenticated` SANS aal2_ok (divergence).
--      ATTENDU : 0 ligne. (profiles : seules les écritures « son propre profil »
--      sont légitimement hors périmètre → exclues ici, cf. cmd.)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND 'authenticated' = ANY (roles)
  AND (
        tablename IN ('messages', 'message_text_keys', 'message_media_keys',
                      'conversations', 'conversation_members')
        OR (tablename = 'profiles' AND cmd = 'SELECT')
  )
  AND COALESCE(qual, '')       NOT ILIKE '%aal2_ok%'
  AND COALESCE(with_check, '') NOT ILIKE '%aal2_ok%'
ORDER BY tablename, policyname;

-- 10d) Comptes visés (2FA vérifiée) vs factoriels — contrôle d'existence.
--      ATTENDU : uniquement des facteurs 'verified' (l'exigence aal2 ne
--      s'applique QU'À ces comptes ; un compte sans ligne ici n'est pas gaté).
SELECT status, count(*) AS factors
FROM auth.mfa_factors
GROUP BY status
ORDER BY status;
-- ============================================================================

-- ============================================================================
-- 11) Vérifications du correctif 20261038 (créateur conserve 'admin' à l'INSERT)
-- ============================================================================

-- 11a) Trigger BEFORE INSERT unique présent : ATTENDU 1 ligne
--      `trg_cm_force_member_role`.
SELECT tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'conversation_members'
  AND NOT t.tgisinternal
  AND tgname = 'trg_cm_force_member_role';

-- 11b) La fonction encode les DEUX branches (exemption créateur + repli
--      'member') et les exemptions système. ATTENDU : les 3 booléens = true.
SELECT
  position('created_by' in prosrc) > 0             AS checks_creator,
  position('NEW.role := ''member''' in prosrc) > 0 AS forces_member_fallback,
  position('service_role' in prosrc) > 0           AS exempts_service_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'force_member_role_on_insert';

-- 11c) NON-RÉGRESSION : le trigger UPDATE anti-escalade doit SUBSISTER.
--      ATTENDU : 1 ligne `trg_prevent_member_role_escalation`.
SELECT tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'conversation_members'
  AND NOT t.tgisinternal
  AND tgname = 'trg_prevent_member_role_escalation';
-- ============================================================================

-- ============================================================================
-- 12) Vérifications du correctif 20261041 (INSERT conversation_members : self)
-- ============================================================================
-- Objectif : self AUTORISÉ, insertion d'un TIERS par un simple membre REFUSÉE,
-- rôle FORCÉ à 'member', gate aal2 CONSERVÉ, anti-escalade UPDATE intact.

-- 12a) UNE seule policy INSERT `cm_insert_creator_or_admin`. ATTENDU : 1 ligne.
SELECT policyname, cmd, roles::text AS roles, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
ORDER BY policyname;

-- 12b) SELF AUTORISÉ : la policy contient la branche `user_id = auth.uid()`.
--      ATTENDU : 1 ligne (`cm_insert_creator_or_admin`).
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
  AND with_check ILIKE '%user_id = auth.uid()%'
ORDER BY policyname;

-- 12c) TIERS REFUSÉ : AUCUNE branche « membre quelconque »
--      (`is_conversation_member` — la faille d'origine). ATTENDU : 0 ligne.
SELECT policyname
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT'
  AND with_check ILIKE '%is_conversation_member%'
ORDER BY policyname;

-- 12c-bis) La policy conserve bien les deux voies « peut insérer un tiers » :
--      créateur (`created_by = auth.uid()`) ET admin/owner
--      (`is_conversation_admin`). ATTENDU : les 2 booléens = true.
SELECT
  with_check ILIKE '%created_by = auth.uid()%'   AS allows_creator,
  with_check ILIKE '%is_conversation_admin%'     AS allows_admin_owner
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT' AND policyname = 'cm_insert_creator_or_admin';

-- 12d) RÔLE FORCÉ : trigger `trg_cm_force_member_role` présent (1 ligne) et
--      fonction qui force `NEW.role := 'member'` pour les non-créateurs
--      (ATTENDU : forces_member_role = true). Le trigger garantit que
--      l'auto-insertion ne peut PAS donner 'admin'.
SELECT tgname, pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'conversation_members'
  AND NOT t.tgisinternal
  AND tgname = 'trg_cm_force_member_role';

SELECT position('NEW.role := ''member''' in prosrc) > 0 AS forces_member_role
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'force_member_role_on_insert';

-- 12e) GATE aal2 CONSERVÉ sur l'INSERT `conversation_members`.
--      ATTENDU : has_aal2_ok = true.
--      ⚠️ Si 20261040_disable_aal2_enforcement (dernier mot) est appliqué, ce
--      contrôle indique l'état RÉEL (aal2 retiré) ; 20261041 le ré-active.
SELECT policyname,
       (COALESCE(qual, '') ILIKE '%aal2_ok%'
        OR COALESCE(with_check, '') ILIKE '%aal2_ok%') AS has_aal2_ok
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'INSERT' AND policyname = 'cm_insert_creator_or_admin';

-- 12f) NON-RÉGRESSION anti-escalade UPDATE : la policy UPDATE et le trigger
--      de plafonnement de rôle subsistent. ATTENDU : 1 ligne + 1 ligne.
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'conversation_members'
  AND cmd = 'UPDATE'
ORDER BY policyname;

SELECT tgname
FROM pg_trigger t
JOIN pg_class c     ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'conversation_members'
  AND NOT t.tgisinternal
  AND tgname = 'trg_prevent_member_role_escalation';

-- 12g) Test fonctionnel (MANUEL, hors lecture seule) — à exécuter dans une
--      session `authenticated` en posant le JWT, ou via l'app :
--        • UPSERT de SA PROPRE ligne (on_conflict=conversation_id,user_id)
--          où l'on est déjà membre → DOIT réussir (200/201), role = 'member'.
--        • INSERT de la ligne d'un AUTRE user_id où l'on n'est ni créateur ni
--          admin/owner → DOIT échouer (403 / RLS violation).
--      Exemple (remplacer <uid>/<conv>) :
--        insert into public.conversation_members (conversation_id, user_id, role)
--        values ('<conv>', '<uid>', 'member')
--        on conflict (conversation_id, user_id) do nothing;   -- self: OK
--        insert into public.conversation_members (conversation_id, user_id, role)
--        values ('<conv>', '<autre_uid>', 'admin');           -- tiers: REFUSÉ
-- ============================================================================

