-- ============================================================================
-- 2026-10-41 — conversation_members INSERT : ré-autoriser l'auto-insertion
-- ============================================================================
-- RÉGRESSION CORRIGÉE
--   L'app fait un UPSERT sur `conversation_members`
--   (`on_conflict=conversation_id,user_id`) pour RE-INSÉRER la membership de
--   l'utilisateur courant (« self-healing ») :
--     • src/pages/ContactsPage.tsx  — ensureMyMembership()
--     • src/pages/ChatViewPage.tsx  — ensureMyMembership()
--   La policy INSERT en vigueur (`cm_insert_creator_or_admin`, derniers mots
--   20261036_fix_cm_insert_role_binding.sql puis 20261037_enforce_aal2.sql)
--   n'autorise QUE le créateur (`conversations.created_by = auth.uid()`) ou un
--   admin/owner (`private.is_conversation_admin`). Un MEMBRE NON CRÉATEUR qui
--   réinsère SA PROPRE ligne reçoit donc un 403 (constaté dans les logs prod).
--   Même effet pour l'ADHÉSION d'un membre via invitation.
--
--   Historique : 20261010_harden_cm_insert_no_self_join.sql puis
--   20261030_audit_final_rls.sql (item #1) avaient FERMÉ la branche
--   `user_id = auth.uid()` pour stopper un IDOR (s'auto-insérer dans une
--   conversation dont on connaît l'uuid, puis lire les messages). Ce
--   durcissement casse le fonctionnement normal de l'app.
--
-- CORRECTIF
--   On ÉLARGIT l'INSERT de `conversation_members` avec une branche d'auto-
--   insertion de SA PROPRE ligne (`user_id = auth.uid()`), tout en conservant :
--     • le CRÉATEUR (`conversations.created_by = auth.uid()`) peut insérer
--       n'importe qui (mêmes droits qu'avant) ;
--     • un ADMIN/OWNER (`private.is_conversation_admin(conversation_id)`) peut
--       insérer n'importe qui ;
--     • TOUT AUTRE CAS — un membre insérant l'`user_id` d'un TIERS — reste
--       REFUSÉ (il n'existe aucune branche « membre quelconque » ou
--       « user_id ≠ auth.uid() ») ;
--     • le trigger `trg_cm_force_member_role` (20261036, affiné par 20261038)
--       force TOUJOURS `role = 'member'` pour un non-créateur → l'auto-
--       insertion NE PEUT PAS donner `'admin'` ;
--     • `AND private.aal2_ok()` (ajouté par 20261037_enforce_aal2.sql) est
--       CONSERVÉ ;
--     • l'anti-escalade UPDATE (`cm_update_self_or_admin` +
--       `trg_prevent_member_role_escalation`) est INCHANGÉ.
--
-- ⚠️  RISQUE RÉOUVERT (ASSUMÉ — voir rapport)
--   Autoriser `user_id = auth.uid()` réouvre PARTIELLEMENT l'IDOR initial :
--   tout utilisateur authentifié qui CONNAÎT l'uuid d'une conversation peut
--   s'y auto-insérer (en 'member') et en lire les messages. Atténuations :
--     • il faut connaître l'uuid (non énuméré : conversation_members/conv
--       SELECT restent gatés par l'appartenance) ;
--     • le rôle inséré est plafonné à 'member' (pas d'admin/owner) ;
--     • `private.aal2_ok()` exige aal2 pour les comptes 2FA ;
--   Cette réouverture est NÉCESSAIRE au fonctionnement de l'app (réparation
--   d'appartenance « self-healing », adhésion par invitation). Une fermeture
--   propre passerait par une RPC SECURITY DEFINER contrôlée par invitation —
--   hors périmètre.
--
-- ⚠️  ORDRE D'APPLICATION DES MIGRATIONS
--   La migration d'urgence 20261040_disable_aal2_enforcement.sql (numéro
--   SUPÉRIEUR) retire `AND private.aal2_ok()` de cette policy. Cette migration
--   repose la version AVEC `aal2_ok()` (état 20261036 + 20261037, comme demandé).
--   Si 20261040 est le dernier mot déployé, appliquer 20261041 ré-active donc
--   le gate aal2 sur l'INSERT `conversation_members` : c'est conforme à la
--   consigne, mais à confirmer avec l'état réel de la base (voir verify §12).
--
-- Idempotente : purge de toute policy INSERT divergente + DROP ... IF EXISTS
-- puis CREATE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Purge défensive : ne laisser QU'UNE policy INSERT pour `authenticated`.
--    (couverture d'un run divergé qui aurait recréé cm_insert_creator_or_member,
--    cm_insert_self, etc.)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cm_insert_creator_or_member" ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_self_or_member"    ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_self"              ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert"                   ON public.conversation_members;
DROP POLICY IF EXISTS "Users can join conversations" ON public.conversation_members;

DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'conversation_members'
          AND cmd        = 'INSERT'
          AND 'authenticated' = ANY (roles)
          AND policyname <> 'cm_insert_creator_or_admin'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_members', r.policyname);
    END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 2) Policy INSERT unique : auto-insertion (self) OU créateur OU admin/owner.
--    Reprise fidèle de 20261037 (créateur/admin + aal2_ok) PLUS la branche
--    `user_id = auth.uid()`. Le `role` reste forcé par trigger (aucune escalade).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cm_insert_creator_or_admin" ON public.conversation_members;
CREATE POLICY "cm_insert_creator_or_admin"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            user_id = auth.uid()                                   -- auto-insertion (self-healing / adhésion)
            OR EXISTS (                                            -- créateur : peut insérer n'importe qui
                SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_id
                  AND c.created_by = auth.uid()
            )
            OR private.is_conversation_admin(conversation_id)      -- admin/owner : peut insérer n'importe qui
        )
        AND private.aal2_ok()                                      -- conservé (20261037)
    );

COMMENT ON POLICY "cm_insert_creator_or_admin" ON public.conversation_members IS
    'INSERT : self (user_id = auth.uid()), OU créateur (conversations.created_by), OU admin/owner (private.is_conversation_admin) ; un tiers inséré par un simple membre est refusé. role forcé à member par trg_cm_force_member_role. Gate aal2 conservé.';

-- ---------------------------------------------------------------------------
-- 3) NON modifiés ici (rappel de non-régression) :
--    • trg_cm_force_member_role / private.force_member_role_on_insert (20261038)
--      → force role='member' sauf ligne du créateur / service_role / sans JWT.
--    • cm_update_self_or_admin + trg_prevent_member_role_escalation
--      → anti-escalade UPDATE inchangée.
-- ============================================================================
-- FIN 20261041_cm_insert_allow_self.sql
-- ============================================================================
