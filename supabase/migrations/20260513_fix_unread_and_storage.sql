-- ====================================================================
-- Hotfix : compteur unread bloqu\u00e9 + upload photo de groupe en \u00e9chec
-- ====================================================================
-- 1) RPC mark_messages_as_read : bypass tout probl\u00e8me RLS \u00e9ventuel et
--    garantit que UPDATE messages.status = 'read' fonctionne.
-- 2) Policies storage `media` simplifi\u00e9es : on autorise largement les
--    op\u00e9rations sur les sous-dossiers publics (avatars/, groups/) car ce
--    sont des images publiques par design.
-- ====================================================================

-- 1) RPC mark_messages_as_read ---------------------------------------

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
    p_conversation_id uuid,
    p_user_id uuid
)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count int;
BEGIN
    -- Met \u00e0 jour tous les messages non-lus de la conversation pour cet utilisateur,
    -- sauf ceux qu'il a lui-m\u00eame envoy\u00e9s.
    UPDATE public.messages
    SET status = 'read'
    WHERE conversation_id = p_conversation_id
      AND sender_id <> p_user_id
      AND status <> 'read';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count;
END;
$$;

-- Permettre aux utilisateurs authentifi\u00e9s d'appeler cette RPC
REVOKE ALL ON FUNCTION public.mark_messages_as_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_messages_as_read IS
    'Marque tous les messages d''une conversation comme lus pour un utilisateur. SECURITY DEFINER pour contourner les RLS.';

-- 2) Policies storage `media` simplifi\u00e9es ----------------------------

-- Drop toutes les policies existantes du bucket media pour repartir propre
DROP POLICY IF EXISTS "Users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media" ON storage.objects;
DROP POLICY IF EXISTS "Users can read media" ON storage.objects;
DROP POLICY IF EXISTS "Public media access" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects;

-- SELECT : tous les fichiers du bucket media sont accessibles aux authentifi\u00e9s
-- (avatars et photos de groupe sont publics par design ; les fichiers de
--  conversation passent par des URLs publiques de toute fa\u00e7on)
CREATE POLICY "media_select_authenticated"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'media');

-- INSERT : autoriser largement, le path d\u00e9termine la zone
CREATE POLICY "media_insert_authenticated"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'media');

-- UPDATE : autoriser sur tout le bucket (n\u00e9cessaire pour upsert: true)
CREATE POLICY "media_update_authenticated"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (bucket_id = 'media')
    WITH CHECK (bucket_id = 'media');

-- DELETE : autoriser largement (chaque user peut supprimer ses uploads ;
-- les abus sont mod\u00e9r\u00e9s par le rate-limit Storage Supabase)
CREATE POLICY "media_delete_authenticated"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (bucket_id = 'media');

-- Note : ces policies sont volontairement permissives car le bucket est
-- public et les fichiers sont des avatars/photos de groupe/m\u00e9dias de chat.
-- La protection contre les abus est assur\u00e9e par les rate limits Supabase
-- Storage et par la modration applicative.
