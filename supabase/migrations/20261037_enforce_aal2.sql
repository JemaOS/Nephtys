-- ============================================================================
-- 2026-10-37 — Exiger aal2 côté serveur pour les comptes AVEC 2FA vérifiée
-- ============================================================================
-- PROBLÈME
--   La 2FA n'était qu'un ÉCRAN client (src/components/MfaGate.tsx +
--   src/lib/twoFactorAuth.ts). Aucune policy RLS ne testait le niveau
--   d'assurance (`aal`). Un attaquant qui possède le MOT DE PASSE obtenait une
--   session `aal1` valide et lisait/écrivait directement via PostgREST
--   (/rest/v1) sans jamais présenter de code TOTP.
--
-- OBJECTIF
--   Exiger `aal2` UNIQUEMENT pour les comptes qui possèdent au moins un
--   facteur MFA VÉRIFIÉ. Un compte SANS 2FA ne doit JAMAIS être bloqué :
--   `private.aal2_ok()` vaut `true` pour lui.
--
--   • Helper `private.requires_aal2()` : vrai ssi l'appelant (auth.uid()) a au
--     moins un facteur `auth.mfa_factors.status = 'verified'`.
--   • Helper `private.aal2_ok()` : `NOT requires_aal2() OR aal = 'aal2'`.
--   • On AJOUTE `AND private.aal2_ok()` aux policies de données sensibles, en
--     RECRÉANT chaque policy à l'identique (mêmes garde-fous), sans rien
--     retirer.
--
-- ⚠️ RISQUE DE VERROUILLAGE (voir rapport) : un compte 2FA dont le JWT ne
--   repasse pas en `aal2` après `verifyMFAChallenge` serait bloqué en lecture
--   ET écriture. Analyse du client : `supabase.auth.mfa.verify()` (supabase-js
--   v2) met à jour la session et le token porte `aal: "aal2"` ; l'échec de
--   lecture de l'AAL est traité fail-CLOSED par MfaGate (l'app n'est pas
--   rendue). Vérifier après application avec supabase/verify/verify_rls.sql §10.
--
-- ÉTAT « DERNIER MOT » DES POLICIES REPRISES (migration -> nom)
--   messages            : 20261010_rls_hardening, 20261010_phase1c_allow_null_sender
--   message_text_keys   : 20261010_text_e2ee, 20261011_e2ee_key_author_rls
--   message_media_keys  : 20261011_e2ee_key_author_rls
--   conversations       : 20261010_rls_hardening, 20261012_rls_conversations_update_scope,
--                         20261030_audit_final_rls
--   conversation_members: 20260727_fix_linter_security_warnings, 20261012_rls_conversation_members_update_scope,
--                         20261036_fix_cm_insert_role_binding, 20260513_security_hardening (DELETE)
--   profiles            : 20261012_rls_profiles_discoverable_select
--
-- Les policies `service_role` (ex. cm_all_service_role, conv_all_service_role)
-- ne sont PAS touchées (Service Role contourne la RLS / n'est pas `authenticated`).
-- Idempotente : CREATE OR REPLACE + DROP POLICY IF EXISTS puis CREATE.
-- ============================================================================

-- Le schéma `private` doit exister (normalement créé par
-- 20260727_fix_linter_security_warnings.sql).
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

-- ---------------------------------------------------------------------------
-- 1) Helper : l'appelant possède-t-il un facteur MFA vérifié ?
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER : `authenticated` n'a AUCUN privilège sur `auth.mfa_factors` ;
-- la lecture se fait donc avec les droits du propriétaire de la fonction
-- (rôle de migration / postgres). STABLE : évalué une fois par requête.
--
-- Si l'accès à `auth.mfa_factors` échoue (droits, table absente — base de test),
-- on renvoie `false` (« pas d'exigence aal2 ») pour ne JAMAIS verrouiller un
-- compte, conformément à la directive. Ce repli est documenté : il ne doit pas
-- masquer un problème en production (sur Supabase le propriétaire lit `auth`).
CREATE OR REPLACE FUNCTION private.requires_aal2()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE
    v_uid uuid := auth.uid();     -- lit le JWT de l'appelant (pas du propriétaire)
    v_required boolean;
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;             -- anon / pas de session : rien à exiger
    END IF;

    BEGIN
        SELECT EXISTS (
            SELECT 1
            FROM auth.mfa_factors f
            WHERE f.user_id = v_uid
              AND f.status::text = 'verified'
        ) INTO v_required;
        RETURN COALESCE(v_required, false);
    EXCEPTION
        WHEN insufficient_privilege THEN RETURN false;
        WHEN undefined_table       THEN RETURN false;
        WHEN undefined_column      THEN RETURN false;
    END;
END;
$function$;

REVOKE ALL ON FUNCTION private.requires_aal2() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.requires_aal2() TO authenticated;

COMMENT ON FUNCTION private.requires_aal2() IS
    'Vrai ssi auth.uid() a >= 1 facteur MFA vérifié (auth.mfa_factors.status=verified). SECURITY DEFINER (lecture du schéma auth non exposé). Repli false si auth indisponible.';

-- ---------------------------------------------------------------------------
-- 2) Helper : le niveau d'assurance courant satisfait-il l'exigence ?
-- ---------------------------------------------------------------------------
-- `NOT requires_aal2()` : compte sans 2FA -> toujours autorisé (ne bloque rien).
-- Sinon, on lit le claim `aal` depuis les claims JWT posés par PostgREST
-- (`request.jwt.claims`). Robuste si le claim est absent : `NULLIF('')::jsonb`
-- -> NULL -> comparaison NULL -> false (donc exigence non satisfaite).
CREATE OR REPLACE FUNCTION private.aal2_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
    SELECT
        NOT private.requires_aal2()
        OR (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal') = 'aal2';
$function$;

REVOKE ALL ON FUNCTION private.aal2_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.aal2_ok() TO authenticated;

COMMENT ON FUNCTION private.aal2_ok() IS
    'Vrai si la 2FA n''est pas requise (aucun facteur vérifié) OU si le JWT courant est en aal2. À AND-er dans les policies sensibles.';


-- ===========================================================================
-- 3) messages
-- ===========================================================================

DROP POLICY IF EXISTS "msg_select_member" ON public.messages;
CREATE POLICY "msg_select_member"
    ON public.messages FOR SELECT
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "msg_insert_sender_member" ON public.messages;
CREATE POLICY "msg_insert_sender_member"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (
        (sender_id IS NULL OR sender_id = auth.uid())
        AND private.is_conversation_member(conversation_id)
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "messages_update_member" ON public.messages;
CREATE POLICY "messages_update_member"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
        AND private.aal2_ok()
    )
    WITH CHECK (
        private.is_conversation_member(conversation_id)
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "msg_delete_sender" ON public.messages;
CREATE POLICY "msg_delete_sender"
    ON public.messages FOR DELETE
    TO authenticated
    USING (
        sender_id = auth.uid()
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 4) message_text_keys  (clés E2EE du texte)
-- ===========================================================================

DROP POLICY IF EXISTS "mtk_select_recipient" ON public.message_text_keys;
CREATE POLICY "mtk_select_recipient"
    ON public.message_text_keys FOR SELECT
    TO authenticated
    USING (
        recipient_id = auth.uid()
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "mtk_insert_sender" ON public.message_text_keys;
CREATE POLICY "mtk_insert_sender"
    ON public.message_text_keys FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_text_keys.message_id
              AND (m.sender_id = auth.uid() OR private.is_message_author(m.id))
        )
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "mtk_delete_sender" ON public.message_text_keys;
CREATE POLICY "mtk_delete_sender"
    ON public.message_text_keys FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_text_keys.message_id
              AND (m.sender_id = auth.uid() OR private.is_message_author(m.id))
        )
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 5) message_media_keys  (clés E2EE des médias)
-- ===========================================================================

DROP POLICY IF EXISTS "mmk_select_recipient" ON public.message_media_keys;
CREATE POLICY "mmk_select_recipient"
    ON public.message_media_keys FOR SELECT
    TO authenticated
    USING (
        recipient_id = auth.uid()
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "mmk_insert_sender" ON public.message_media_keys;
CREATE POLICY "mmk_insert_sender"
    ON public.message_media_keys FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_media_keys.message_id
              AND (m.sender_id = auth.uid() OR private.is_message_author(m.id))
        )
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "mmk_delete_sender" ON public.message_media_keys;
CREATE POLICY "mmk_delete_sender"
    ON public.message_media_keys FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_media_keys.message_id
              AND (m.sender_id = auth.uid() OR private.is_message_author(m.id))
        )
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 6) conversations
-- ===========================================================================

DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (
        (private.is_conversation_member(id) OR created_by = auth.uid())
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "conv_insert_creator" ON public.conversations;
CREATE POLICY "conv_insert_creator"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "conv_update_admin_or_creator" ON public.conversations;
CREATE POLICY "conv_update_admin_or_creator"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (
        (
            created_by = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversation_members cm
                WHERE cm.conversation_id = conversations.id
                  AND cm.user_id = auth.uid()
                  AND cm.role IN ('admin', 'owner')
            )
        )
        AND private.aal2_ok()
    )
    WITH CHECK (
        (
            created_by = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversation_members cm
                WHERE cm.conversation_id = conversations.id
                  AND cm.user_id = auth.uid()
                  AND cm.role IN ('admin', 'owner')
            )
        )
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "conv_delete_creator" ON public.conversations;
CREATE POLICY "conv_delete_creator"
    ON public.conversations FOR DELETE
    TO authenticated
    USING (
        created_by = auth.uid()
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 7) conversation_members
-- ===========================================================================

DROP POLICY IF EXISTS "cm_select_member" ON public.conversation_members;
CREATE POLICY "cm_select_member"
    ON public.conversation_members FOR SELECT
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "cm_insert_creator_or_admin" ON public.conversation_members;
CREATE POLICY "cm_insert_creator_or_admin"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
        (
            EXISTS (
                SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_id
                  AND c.created_by = auth.uid()
            )
            OR private.is_conversation_admin(conversation_id)
        )
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "cm_update_self_or_admin" ON public.conversation_members;
CREATE POLICY "cm_update_self_or_admin"
    ON public.conversation_members FOR UPDATE
    TO authenticated
    USING (
        (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_members.conversation_id
                  AND c.created_by = auth.uid()
            )
            OR EXISTS (
                SELECT 1 FROM public.conversation_members cm
                WHERE cm.conversation_id = conversation_members.conversation_id
                  AND cm.user_id = auth.uid()
                  AND cm.role IN ('admin', 'owner')
            )
        )
        AND private.aal2_ok()
    )
    WITH CHECK (
        (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_members.conversation_id
                  AND c.created_by = auth.uid()
            )
            OR EXISTS (
                SELECT 1 FROM public.conversation_members cm
                WHERE cm.conversation_id = conversation_members.conversation_id
                  AND cm.user_id = auth.uid()
                  AND cm.role IN ('admin', 'owner')
            )
        )
        AND private.aal2_ok()
    );

-- ⚠️ DEUX policies DELETE historiques coexistent (elles se cumulent en OR) :
--   • cm_delete_own_or_admin    (20260513_security_hardening.sql:97)
--   • cm_delete_self_or_creator (20261010_rls_hardening.sql:123)
-- Aucune migration postérieure ne les a supprimées : on préserve CHACUNE
-- (mêmes conditions) en y ajoutant seulement aal2_ok. En les recréant toutes
-- les deux, on ne réduit ni n'élargit la portée effective.
DROP POLICY IF EXISTS "cm_delete_self_or_creator" ON public.conversation_members;
CREATE POLICY "cm_delete_self_or_creator"
    ON public.conversation_members FOR DELETE
    TO authenticated
    USING (
        (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversations c
                WHERE c.id = conversation_members.conversation_id
                  AND c.created_by = auth.uid()
            )
        )
        AND private.aal2_ok()
    );

DROP POLICY IF EXISTS "cm_delete_own_or_admin" ON public.conversation_members;
CREATE POLICY "cm_delete_own_or_admin"
    ON public.conversation_members FOR DELETE
    TO authenticated
    USING (
        (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.conversation_members cm_admin
                WHERE cm_admin.conversation_id = conversation_members.conversation_id
                  AND cm_admin.user_id = auth.uid()
                  AND cm_admin.role IN ('admin', 'owner')
            )
        )
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 8) profiles  (uniquement SELECT : annuaire / anti-énumération)
-- ===========================================================================
-- Les policies d'écriture « son propre profil » (UPDATE/INSERT/DELETE) ne sont
-- PAS gatées : elles ne donnent accès à aucune donnée tierce.

DROP POLICY IF EXISTS "profiles_select_discoverable_or_related" ON public.profiles;
CREATE POLICY "profiles_select_discoverable_or_related"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
        (
            id = auth.uid()
            OR discoverable
            OR EXISTS (
                SELECT 1
                FROM public.conversation_members cm_self
                JOIN public.conversation_members cm_other
                  ON cm_self.conversation_id = cm_other.conversation_id
                WHERE cm_self.user_id = auth.uid()
                  AND cm_other.user_id = profiles.id
            )
            OR EXISTS (
                SELECT 1
                FROM public.contacts c
                WHERE (c.user_id = auth.uid() AND c.contact_user_id = profiles.id)
                   OR (c.user_id = profiles.id AND c.contact_user_id = auth.uid())
            )
        )
        AND private.aal2_ok()
    );


-- ===========================================================================
-- 9) Garde-fou : signaler toute policy `authenticated` de données sensibles
--    qui aurait échappé au gate aal2 (état remote divergé). N'interrompt pas
--    la migration ; lister via supabase/verify/verify_rls.sql §10.
-- ===========================================================================
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT tablename, policyname, cmd
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
    LOOP
        RAISE WARNING 'aal2 NON appliqué à public.%.% (%) — policy divergente à traiter',
            r.tablename, r.policyname, r.cmd;
    END LOOP;
END
$mig$;

-- ============================================================================
-- FIN 20261037_enforce_aal2.sql
-- ============================================================================
