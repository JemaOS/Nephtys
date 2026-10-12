-- ============================================================================
-- 2026-10-40 — DÉSACTIVATION D'URGENCE de l'exigence aal2 (REVERT)
-- ============================================================================
-- ⚠️  À N'APPLIQUER QU'EN CAS DE VERROUILLAGE (LOCKOUT) ⚠️
--
--   Cette migration est un FILET DE DERNIER RECOURS, pas un correctif normal.
--   Elle RETIRE `AND private.aal2_ok()` des 20 policies que
--   20261037_enforce_aal2.sql avait gatées, afin de rétablir immédiatement
--   l'accès si des comptes légitimes se retrouvent bloqués (« app vide » :
--   0 ligne / erreur RLS alors que la session est valide).
--
--   ELLE RÉOUVRE LA FAILLE QUE 20261037 FERMAIT : un attaquant qui possède
--   uniquement le MOT DE PASSE peut à nouveau lire/écrire via PostgREST
--   (/rest/v1) sans présenter de code TOTP. À n'utiliser que pour débloquer,
--   puis RÉAPPLIQUER 20261037 (ou son successeur corrigé) dès que possible.
--
-- QUAND L'APPLIQUER
--   • Des comptes AVEC 2FA vérifiée restent en `aal1` après `verifyMFAChallenge`
--     (le JWT ne porte pas `aal: "aal2"`), donc toutes les lectures/écritures
--     renvoient 0 ligne / une erreur RLS.
--   • Le helper `private.aal2_ok()` ou l'accès à `auth.mfa_factors` est cassé.
--   • Toute situation où l'exigence aal2 côté serveur bloque des utilisateurs
--     légitimes et où le correctif client/serveur n'est pas encore déployable.
--
-- CE QUE FAIT CETTE MIGRATION
--   Pour chaque policy sensible, DROP POLICY IF EXISTS puis CREATE à
--   l'IDENTIQUE, en préservant TOUTES les autres conditions (mêmes USING /
--   WITH CHECK), en retirant SEULEMENT `AND private.aal2_ok()`.
--   Idempotente (DROP IF EXISTS + CREATE).
--
--   Les helpers `private.requires_aal2()` / `private.aal2_ok()` ne sont PAS
--   supprimés (inoffensifs une fois plus référencés ; ils restent disponibles
--   si 20261037 est réappliquée). Pour les retirer explicitement :
--     -- DROP FUNCTION IF EXISTS private.aal2_ok();
--     -- DROP FUNCTION IF EXISTS private.requires_aal2();
--
-- APRÈS APPLICATION
--   `supabase/verify/verify_rls.sql` §10b/§10c signaleront des policies SANS
--   `aal2_ok` (« divergence ») : c'est ATTENDU pour ce revert d'urgence.
--   Réappliquez 20261037_enforce_aal2.sql pour restaurer l'exigence et faire
--   repasser ces contrôles au vert.
--
-- Reprise fidèle de 20261037_enforce_aal2.sql (mêmes conditions, moins
-- `AND private.aal2_ok()`).
-- ============================================================================


-- ===========================================================================
-- 1) messages
-- ===========================================================================

DROP POLICY IF EXISTS "msg_select_member" ON public.messages;
CREATE POLICY "msg_select_member"
    ON public.messages FOR SELECT
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
    );

DROP POLICY IF EXISTS "msg_insert_sender_member" ON public.messages;
CREATE POLICY "msg_insert_sender_member"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (
        (sender_id IS NULL OR sender_id = auth.uid())
        AND private.is_conversation_member(conversation_id)
    );

DROP POLICY IF EXISTS "messages_update_member" ON public.messages;
CREATE POLICY "messages_update_member"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
    )
    WITH CHECK (
        private.is_conversation_member(conversation_id)
    );

DROP POLICY IF EXISTS "msg_delete_sender" ON public.messages;
CREATE POLICY "msg_delete_sender"
    ON public.messages FOR DELETE
    TO authenticated
    USING (
        sender_id = auth.uid()
    );


-- ===========================================================================
-- 2) message_text_keys  (clés E2EE du texte)
-- ===========================================================================

DROP POLICY IF EXISTS "mtk_select_recipient" ON public.message_text_keys;
CREATE POLICY "mtk_select_recipient"
    ON public.message_text_keys FOR SELECT
    TO authenticated
    USING (
        recipient_id = auth.uid()
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
    );


-- ===========================================================================
-- 3) message_media_keys  (clés E2EE des médias)
-- ===========================================================================

DROP POLICY IF EXISTS "mmk_select_recipient" ON public.message_media_keys;
CREATE POLICY "mmk_select_recipient"
    ON public.message_media_keys FOR SELECT
    TO authenticated
    USING (
        recipient_id = auth.uid()
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
    );


-- ===========================================================================
-- 4) conversations
-- ===========================================================================

DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (
        (private.is_conversation_member(id) OR created_by = auth.uid())
    );

DROP POLICY IF EXISTS "conv_insert_creator" ON public.conversations;
CREATE POLICY "conv_insert_creator"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
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
    );

DROP POLICY IF EXISTS "conv_delete_creator" ON public.conversations;
CREATE POLICY "conv_delete_creator"
    ON public.conversations FOR DELETE
    TO authenticated
    USING (
        created_by = auth.uid()
    );


-- ===========================================================================
-- 5) conversation_members
-- ===========================================================================

DROP POLICY IF EXISTS "cm_select_member" ON public.conversation_members;
CREATE POLICY "cm_select_member"
    ON public.conversation_members FOR SELECT
    TO authenticated
    USING (
        private.is_conversation_member(conversation_id)
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
    );

-- DEUX policies DELETE historiques coexistent (elles se cumulent en OR) :
--   • cm_delete_self_or_creator  (20261010_rls_hardening.sql)
--   • cm_delete_own_or_admin     (20260513_security_hardening.sql)
-- On préserve CHACUNE à l'identique, sans le gate aal2.

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
    );


-- ===========================================================================
-- 6) profiles  (uniquement SELECT : annuaire / anti-énumération)
-- ===========================================================================

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
    );


-- ============================================================================
-- FIN 20261040_disable_aal2_enforcement.sql
-- RAPPEL : réappliquer 20261037_enforce_aal2.sql dès que possible.
-- ============================================================================
