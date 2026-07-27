-- ============================================================================
-- Fix warnings Supabase Database Linter (27 juillet 2026)
-- ============================================================================
-- Findings traités :
--
--   1. is_conversation_member (authenticated_security_definer_function_executable)
--      → déplacée dans le schéma `private`, non exposé par PostgREST.
--      C'est un helper RLS : il DOIT rester SECURITY DEFINER (anti-récursion)
--      et EXECUTABLE par authenticated (requis pour l'évaluation des policies —
--      le REVOKE de 20260513_fix_security_definer_warnings.sql cassait tout,
--      cf. 20260513_fix_rls_and_storage_policies.sql). Le schéma private
--      conserve ces propriétés mais supprime l'exposition /rest/v1/rpc.
--
--   2. get_user_conversations (authenticated_security_definer_function_executable)
--      → SECURITY INVOKER. Les policies RLS des tables lues (conversations,
--      conversation_members, messages, profiles) filtrent déjà exactement ce
--      que l'appelant peut voir ; le garde p_user_id = auth.uid() est conservé
--      en défense en profondeur.
--
--   3. mark_messages_as_read (authenticated_security_definer_function_executable)
--      → SECURITY INVOKER + policy UPDATE basée sur la membership.
--      La version précédente (20260513_fix_unread_and_storage.sql) était une
--      régression : SECURITY DEFINER, sans vérification auth.uid(), avec
--      p_user_id libre → n'importe quel utilisateur authentifié pouvait marquer
--      les messages de n'importe qui. Cette version :
--        - ignore p_user_id et force auth.uid() (anti-usurpation)
--        - vérifie que l'appelant est membre de la conversation
--        - s'appuie sur la nouvelle policy "messages_update_member" (les reçus
--          de lecture modifient les messages des AUTRES membres, ce que la
--          policy historique "Users update own messages" bloquait)
--
--   4. auth_leaked_password_protection : non traitable par SQL.
--      À activer dans le dashboard : Authentication → Password Security →
--      "Leaked password protection" (HaveIBeenPwned).
-- ============================================================================


-- ============================================================================
-- 1) is_conversation_member → schéma private
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- USAGE sur le schéma est requis pour que les policies des requêtes
-- authentifiées puissent évaluer la fonction. PostgREST n'expose que le
-- schéma `public`, donc la fonction reste inaccessible via l'API REST.
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id = p_conversation_id
          AND cm.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION private.is_conversation_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_conversation_member(uuid) TO authenticated;

-- Policies conversation_members : repointer vers le helper private
DROP POLICY IF EXISTS "cm_select_member" ON public.conversation_members;
CREATE POLICY "cm_select_member"
    ON public.conversation_members
    FOR SELECT
    TO authenticated
    USING (private.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "cm_insert_self_or_member" ON public.conversation_members;
CREATE POLICY "cm_insert_self_or_member"
    ON public.conversation_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        OR private.is_conversation_member(conversation_id)
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND c.created_by = auth.uid()
        )
    );

-- Policy conversations : repointer vers le helper private
DROP POLICY IF EXISTS "conv_select_member" ON public.conversations;
CREATE POLICY "conv_select_member"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (
        private.is_conversation_member(id)
        OR created_by = auth.uid()
    );

-- Supprimer l'ancienne fonction publique. Si cette commande échoue parce
-- qu'une autre policy y fait encore référence (état remote divergé), lister
-- les dépendances avec :
--   SELECT * FROM pg_depend WHERE refobjid = 'public.is_conversation_member(uuid)'::regprocedure;
DROP FUNCTION public.is_conversation_member(uuid);


-- ============================================================================
-- 2) get_user_conversations → SECURITY INVOKER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_user_conversations(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    result jsonb;
BEGIN
    -- Garde-fou : un utilisateur ne peut récupérer QUE ses propres conversations
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'Forbidden: can only fetch own conversations';
    END IF;

    WITH user_memberships AS (
        SELECT cm.conversation_id, cm.is_archived, cm.is_muted, cm.is_pinned, cm.last_read_at, cm.role
        FROM public.conversation_members cm
        WHERE cm.user_id = p_user_id
          AND cm.is_archived IS NOT TRUE
    ),
    convs AS (
        SELECT c.*
        FROM public.conversations c
        WHERE c.id IN (SELECT conversation_id FROM user_memberships)
    ),
    all_members AS (
        SELECT cm.conversation_id, cm.user_id, cm.role
        FROM public.conversation_members cm
        WHERE cm.conversation_id IN (SELECT conversation_id FROM user_memberships)
    ),
    member_profiles AS (
        SELECT p.id, p.username, p.display_name, p.avatar_url, p.bio
        FROM public.profiles p
        WHERE p.id IN (SELECT DISTINCT user_id FROM all_members)
    ),
    last_messages AS (
        SELECT DISTINCT ON (m.conversation_id)
            m.id, m.conversation_id, m.sender_id, m.content, m.type,
            m.media_url, m.file_url, m.media_thumbnail, m.status,
            m.created_at, m.is_ephemeral, m.ephemeral_expires_at
        FROM public.messages m
        WHERE m.conversation_id IN (SELECT conversation_id FROM user_memberships)
          AND m.deleted_at IS NULL
          AND (m.ephemeral_expires_at IS NULL OR m.ephemeral_expires_at > NOW())
        ORDER BY m.conversation_id, m.created_at DESC
    ),
    unread_counts AS (
        SELECT m.conversation_id, COUNT(*)::int AS unread
        FROM public.messages m
        JOIN user_memberships um ON um.conversation_id = m.conversation_id
        WHERE m.sender_id <> p_user_id
          AND m.deleted_at IS NULL
          AND m.status <> 'read'
          AND (um.last_read_at IS NULL OR m.created_at > um.last_read_at)
        GROUP BY m.conversation_id
    )
    SELECT jsonb_build_object(
        'conversations', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM convs c), '[]'::jsonb),
        'memberships',   COALESCE((SELECT jsonb_agg(to_jsonb(um)) FROM user_memberships um), '[]'::jsonb),
        'allMembers',    COALESCE((SELECT jsonb_agg(to_jsonb(am)) FROM all_members am), '[]'::jsonb),
        'profiles',      COALESCE((SELECT jsonb_agg(to_jsonb(mp)) FROM member_profiles mp), '[]'::jsonb),
        'lastMessages',  COALESCE((SELECT jsonb_agg(to_jsonb(lm)) FROM last_messages lm), '[]'::jsonb),
        'unreadCounts',  COALESCE((SELECT jsonb_agg(to_jsonb(uc)) FROM unread_counts uc), '[]'::jsonb)
    ) INTO result;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_conversations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_conversations(uuid) TO authenticated;


-- ============================================================================
-- 3) mark_messages_as_read → SECURITY INVOKER + policy UPDATE membership
-- ============================================================================

-- Policy : les membres d'une conversation peuvent y mettre à jour les messages
-- (reçus de lecture, épinglage, favoris — opérations déjà effectuées par
-- l'app en écriture directe). Complète "Users update own messages".
DROP POLICY IF EXISTS "messages_update_member" ON public.messages;
CREATE POLICY "messages_update_member"
    ON public.messages
    FOR UPDATE
    TO authenticated
    USING (private.is_conversation_member(conversation_id))
    WITH CHECK (private.is_conversation_member(conversation_id));

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
    p_conversation_id uuid,
    p_user_id         uuid   -- conservé pour rétrocompatibilité API mais IGNORÉ
)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_count   int;
BEGIN
    -- Sécurité : seul l'utilisateur connecté peut marquer ses propres reçus
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Vérifier que le caller est bien membre de la conversation
    IF NOT private.is_conversation_member(p_conversation_id) THEN
        RAISE EXCEPTION 'Access denied: not a member of this conversation';
    END IF;

    -- Met à jour uniquement les messages des AUTRES membres (pas les siens)
    UPDATE public.messages
    SET status = 'read'
    WHERE conversation_id = p_conversation_id
      AND sender_id <> v_caller
      AND status <> 'read';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_messages_as_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_messages_as_read IS
    'Marque les messages d''une conversation comme lus pour l''utilisateur CONNECTÉ '
    '(auth.uid()). Le paramètre p_user_id est ignoré pour des raisons de sécurité. '
    'Vérifie que l''appelant est membre de la conversation.';
