-- ============================================================================
-- DURCISSEMENT RLS (suite de 1764470800_ultra_permissive_rls.sql)
-- ============================================================================
-- PROBLÈME : la migration debug 1764470800 a fait « DROP ALL POLICIES » sur
-- tout le schéma public, puis recréé des policies `*_all` FOR ALL USING(true)
-- pour les utilisateurs AUTHENTIFIÉS. Ces policies permissives n'ont jamais
-- été supprimées : n'importe quel compte authentifié peut donc lire ET écrire
-- les messages, conversations, profils, statuts, appareils, etc. de TOUT LE
-- MONDE (contrôle d'accès cassé).
--
-- CE CORRECTIF :
--   1. supprime toutes les policies `*_all` permissives ;
--   2. restaure des policies correctes, limitées au propriétaire ou aux
--      membres de la conversation (via private.is_conversation_member,
--      SECURITY DEFINER, qui évite la récursion RLS sur conversation_members).
--
-- L'E2EE chiffre le CONTENU, mais la RLS protège les MÉTADONNÉES et
-- l'intégrité : les deux sont nécessaires.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Supprimer les policies permissives de la migration debug
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cm_all"          ON public.conversation_members;
DROP POLICY IF EXISTS "conv_all"        ON public.conversations;
DROP POLICY IF EXISTS "msg_all"         ON public.messages;
DROP POLICY IF EXISTS "contacts_all"    ON public.contacts;
DROP POLICY IF EXISTS "profiles_all"    ON public.profiles;
DROP POLICY IF EXISTS "statuses_all"    ON public.statuses;
DROP POLICY IF EXISTS "devices_all"     ON public.devices;
DROP POLICY IF EXISTS "call_logs_all"   ON public.call_logs;
DROP POLICY IF EXISTS "files_all"       ON public.files;
DROP POLICY IF EXISTS "reactions_all"   ON public.message_reactions;

-- ---------------------------------------------------------------------------
-- 1) profiles — lecture par les authentifiés, écriture par le propriétaire
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_authenticated"     ON public.profiles;

CREATE POLICY "profiles_select_authenticated"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own profile" ON public.profiles;
CREATE POLICY "Users can delete own profile"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) conversations
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member"
    ON public.conversations FOR SELECT
    TO authenticated
    USING (private.is_conversation_member(id) OR created_by = auth.uid());

DROP POLICY IF EXISTS "conv_insert_creator" ON public.conversations;
CREATE POLICY "conv_insert_creator"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "conv_update_member" ON public.conversations;
CREATE POLICY "conv_update_member"
    ON public.conversations FOR UPDATE
    TO authenticated
    USING (private.is_conversation_member(id))
    WITH CHECK (private.is_conversation_member(id));

DROP POLICY IF EXISTS "conv_delete_creator" ON public.conversations;
CREATE POLICY "conv_delete_creator"
    ON public.conversations FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- 3) conversation_members
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cm_select_member" ON public.conversation_members;
CREATE POLICY "cm_select_member"
    ON public.conversation_members FOR SELECT
    TO authenticated
    USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "cm_insert_self_or_member" ON public.conversation_members;
CREATE POLICY "cm_insert_self_or_member"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        OR private.is_conversation_member(conversation_id)
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id AND c.created_by = auth.uid()
        )
    );

DROP POLICY IF EXISTS "cm_update_self" ON public.conversation_members;
CREATE POLICY "cm_update_self"
    ON public.conversation_members FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid() OR private.is_conversation_member(conversation_id))
    WITH CHECK (user_id = auth.uid() OR private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "cm_delete_self_or_creator" ON public.conversation_members;
CREATE POLICY "cm_delete_self_or_creator"
    ON public.conversation_members FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id AND c.created_by = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- 4) messages
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "msg_select_member" ON public.messages;
CREATE POLICY "msg_select_member"
    ON public.messages FOR SELECT
    TO authenticated
    USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "msg_insert_sender_member" ON public.messages;
CREATE POLICY "msg_insert_sender_member"
    ON public.messages FOR INSERT
    TO authenticated
    WITH CHECK (
        sender_id = auth.uid()
        AND private.is_conversation_member(conversation_id)
    );

-- Les reçus de lecture / épinglage modifient les messages des autres membres.
DROP POLICY IF EXISTS "messages_update_member" ON public.messages;
CREATE POLICY "messages_update_member"
    ON public.messages FOR UPDATE
    TO authenticated
    USING (private.is_conversation_member(conversation_id))
    WITH CHECK (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "msg_delete_sender" ON public.messages;
CREATE POLICY "msg_delete_sender"
    ON public.messages FOR DELETE
    TO authenticated
    USING (sender_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 5) contacts — strictement le propriétaire
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "contacts_owner_all" ON public.contacts;
CREATE POLICY "contacts_owner_all"
    ON public.contacts FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 6) statuses — propriétaire, plus visibilité publique des contacts
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "statuses_select_visible" ON public.statuses;
CREATE POLICY "statuses_select_visible"
    ON public.statuses FOR SELECT
    TO authenticated
    USING (
        user_id = auth.uid()
        OR (
            NOT is_private
            AND expires_at > NOW()
            AND EXISTS (
                SELECT 1 FROM public.contacts c
                WHERE c.user_id = statuses.user_id AND c.contact_user_id = auth.uid()
            )
        )
    );

DROP POLICY IF EXISTS "statuses_write_owner" ON public.statuses;
CREATE POLICY "statuses_write_owner"
    ON public.statuses FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "statuses_update_owner" ON public.statuses;
CREATE POLICY "statuses_update_owner"
    ON public.statuses FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "statuses_delete_owner" ON public.statuses;
CREATE POLICY "statuses_delete_owner"
    ON public.statuses FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 7) devices — strictement le propriétaire
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "devices_owner_all" ON public.devices;
CREATE POLICY "devices_owner_all"
    ON public.devices FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8) files — membres de la conversation du message parent
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "files_select_member" ON public.files;
CREATE POLICY "files_select_member"
    ON public.files FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = files.message_id
              AND private.is_conversation_member(m.conversation_id)
        )
    );

DROP POLICY IF EXISTS "files_insert_uploader" ON public.files;
CREATE POLICY "files_insert_uploader"
    ON public.files FOR INSERT
    TO authenticated
    WITH CHECK (uploader_id = auth.uid());

DROP POLICY IF EXISTS "files_delete_uploader" ON public.files;
CREATE POLICY "files_delete_uploader"
    ON public.files FOR DELETE
    TO authenticated
    USING (uploader_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 9) call_logs — membres de la conversation
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "call_logs_select_member" ON public.call_logs;
CREATE POLICY "call_logs_select_member"
    ON public.call_logs FOR SELECT
    TO authenticated
    USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "call_logs_insert_caller" ON public.call_logs;
CREATE POLICY "call_logs_insert_caller"
    ON public.call_logs FOR INSERT
    TO authenticated
    WITH CHECK (caller_id = auth.uid() AND private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "call_logs_update_caller" ON public.call_logs;
CREATE POLICY "call_logs_update_caller"
    ON public.call_logs FOR UPDATE
    TO authenticated
    USING (caller_id = auth.uid())
    WITH CHECK (caller_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 10) message_reactions — membres via le message, écriture par l'auteur
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "reactions_select_member" ON public.message_reactions;
CREATE POLICY "reactions_select_member"
    ON public.message_reactions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_reactions.message_id
              AND private.is_conversation_member(m.conversation_id)
        )
    );

DROP POLICY IF EXISTS "reactions_insert_self" ON public.message_reactions;
CREATE POLICY "reactions_insert_self"
    ON public.message_reactions FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_reactions.message_id
              AND private.is_conversation_member(m.conversation_id)
        )
    );

DROP POLICY IF EXISTS "reactions_delete_self" ON public.message_reactions;
CREATE POLICY "reactions_delete_self"
    ON public.message_reactions FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());
