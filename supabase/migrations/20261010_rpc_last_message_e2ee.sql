-- ============================================================================
-- Fix : la LISTE des conversations affichait le ciphertext du dernier message
-- ============================================================================
-- Cause : le RPC `get_user_conversations` construisait `lastMessages` avec une
-- liste de colonnes explicites qui N'INCLUAIT PAS `is_text_encrypted` ni
-- `encryption_metadata`. Le client ne pouvait donc pas déchiffrer l'aperçu du
-- dernier message (contrairement à la conversation ouverte, qui charge les
-- colonnes complètes). On ajoute simplement ces 2 colonnes au sous-ensemble
-- `last_messages` — aucun autre changement de comportement.
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
            m.created_at, m.is_ephemeral, m.ephemeral_expires_at,
            -- E2EE : nécessaires pour déchiffrer l'aperçu côté client
            m.is_text_encrypted, m.encryption_metadata
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
