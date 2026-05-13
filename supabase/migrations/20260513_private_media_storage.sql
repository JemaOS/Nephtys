-- ====================================================================
-- Confidentialit\u00e9 : bucket `media` en mode priv\u00e9
-- ====================================================================
-- Avant : bucket public => quiconque avec une URL pouvait acc\u00e9der aux
-- fichiers \u00e9chang\u00e9s en conversation (audio, images, vid\u00e9os).
--
-- Apr\u00e8s : bucket priv\u00e9. L'acc\u00e8s aux fichiers passe par :
--   \u2022 SELECT RLS pour les m\u00e9dias accessibles \u00e0 l'utilisateur
--   \u2022 createSignedUrl() c\u00f4t\u00e9 client pour g\u00e9n\u00e9rer une URL temporaire (1h)
--
-- Structure des paths conserv\u00e9e :
--   avatars/<userId>/...    \u2192 photos de profil (visibles \u00e0 tous les auth)
--   groups/<convId>/...     \u2192 photos de groupe (membres de la conv)
--   <userId>/<folder>/...   \u2192 m\u00e9dias \u00e9chang\u00e9s en conv (priv\u00e9 strict)
--   restored/<userId>/...   \u2192 backups restaur\u00e9s (priv\u00e9 au user)
-- ====================================================================

-- 1) Passer le bucket `media` en priv\u00e9 -------------------------------

UPDATE storage.buckets
SET public = false
WHERE id = 'media';

-- 2) Drop toutes les policies actuelles du bucket media --------------

DROP POLICY IF EXISTS "media_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_delete_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media" ON storage.objects;
DROP POLICY IF EXISTS "Users can read media" ON storage.objects;
DROP POLICY IF EXISTS "Public media access" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects;

-- 3) Helper : v\u00e9rifie si l'utilisateur courant a acc\u00e8s \u00e0 un path -----
-- D\u00e9compose le path en (folder1, folder2, rest) et applique la r\u00e8gle.
-- SECURITY DEFINER pour bypass la RLS de conversation_members.

CREATE OR REPLACE FUNCTION public.can_access_media(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_parts text[];
    v_folder text;
    v_subfolder text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    v_parts := string_to_array(p_path, '/');
    IF array_length(v_parts, 1) < 2 THEN
        RETURN false;
    END IF;

    v_folder := v_parts[1];
    v_subfolder := v_parts[2];

    -- avatars/<userId>/... \u2192 lecture pour tous les authentifi\u00e9s
    IF v_folder = 'avatars' THEN
        RETURN true;
    END IF;

    -- groups/<convId>/... \u2192 r\u00e9serv\u00e9 aux membres de la conversation
    IF v_folder = 'groups' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id::text = v_subfolder
              AND cm.user_id = v_uid
        );
    END IF;

    -- restored/<userId>/... \u2192 r\u00e9serv\u00e9 au propri\u00e9taire
    IF v_folder = 'restored' THEN
        RETURN v_subfolder = v_uid::text;
    END IF;

    -- <userId>/<folder>/... \u2192 acc\u00e8s pour le propri\u00e9taire OU pour les
    -- membres d'une conversation o\u00f9 ce m\u00e9dia est partag\u00e9
    IF v_folder = v_uid::text THEN
        RETURN true;
    END IF;

    -- Sinon : l'autre cas o\u00f9 v_folder est un userId, v\u00e9rifier qu'on partage
    -- une conversation avec lui (et donc qu'on peut voir ses m\u00e9dias)
    -- Note : cette politique pourrait \u00eatre durcie en exigeant que le path
    -- exact soit r\u00e9f\u00e9renc\u00e9 dans messages.media_url, mais c'est plus co\u00fbteux.
    BEGIN
        RETURN EXISTS (
            SELECT 1
            FROM public.conversation_members cm1
            JOIN public.conversation_members cm2
              ON cm1.conversation_id = cm2.conversation_id
            WHERE cm1.user_id = v_uid
              AND cm2.user_id::text = v_folder
        );
    EXCEPTION WHEN invalid_text_representation THEN
        -- v_folder n'est pas un UUID valide
        RETURN false;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_media(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_media(text) TO authenticated;

-- 4) Policies storage bas\u00e9es sur le helper --------------------------

-- SELECT : peut lire si can_access_media() retourne true
CREATE POLICY "media_select_by_membership"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'media'
        AND public.can_access_media(name)
    );

-- INSERT : peut uploader dans son propre dossier OU dans avatars/<self>/
-- OU dans groups/<convId>/ s'il est membre OU dans restored/<self>/
CREATE POLICY "media_insert_owner_or_group"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'media'
        AND auth.uid() IS NOT NULL
        AND (
            -- avatars/<self>/...
            (
                (storage.foldername(name))[1] = 'avatars'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            -- groups/<convId>/... si membre
            OR (
                (storage.foldername(name))[1] = 'groups'
                AND EXISTS (
                    SELECT 1 FROM public.conversation_members cm
                    WHERE cm.conversation_id::text = (storage.foldername(name))[2]
                      AND cm.user_id = auth.uid()
                )
            )
            -- restored/<self>/...
            OR (
                (storage.foldername(name))[1] = 'restored'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            -- <self>/...
            OR (storage.foldername(name))[1] = auth.uid()::text
        )
    );

-- UPDATE : m\u00eame conditions qu'INSERT (n\u00e9cessaire pour upsert: true)
CREATE POLICY "media_update_owner_or_group"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'media'
        AND auth.uid() IS NOT NULL
        AND (
            (
                (storage.foldername(name))[1] = 'avatars'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            OR (
                (storage.foldername(name))[1] = 'groups'
                AND EXISTS (
                    SELECT 1 FROM public.conversation_members cm
                    WHERE cm.conversation_id::text = (storage.foldername(name))[2]
                      AND cm.user_id = auth.uid()
                )
            )
            OR (
                (storage.foldername(name))[1] = 'restored'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            OR (storage.foldername(name))[1] = auth.uid()::text
        )
    )
    WITH CHECK (bucket_id = 'media');

-- DELETE : seulement ses propres fichiers
CREATE POLICY "media_delete_owner"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'media'
        AND auth.uid() IS NOT NULL
        AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR (
                (storage.foldername(name))[1] = 'avatars'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            OR (
                (storage.foldername(name))[1] = 'restored'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
            -- groups : delete autoris\u00e9 seulement aux admins/owners de la conv
            OR (
                (storage.foldername(name))[1] = 'groups'
                AND EXISTS (
                    SELECT 1 FROM public.conversation_members cm
                    WHERE cm.conversation_id::text = (storage.foldername(name))[2]
                      AND cm.user_id = auth.uid()
                      AND cm.role IN ('admin', 'owner')
                )
            )
        )
    );
