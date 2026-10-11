-- ============================================================================
-- 2026-10-30 — Correctifs d'audit (final) : Storage (items #3 et #5)
-- ============================================================================
-- Item #3 : les buckets `avatars` et `files` ont été créés PUBLICS par les
--   edge functions historiques `create-bucket-avatars-temp` / `-files-temp`
--   (aujourd'hui neutralisées 410) via l'API Storage + des policies ouvertes
--   injectées par le RPC `exec_sql`. On referme : buckets privés + suppression
--   des policies bucket-wide connues, + purge défensive de toute policy
--   storage visant `avatars`/`files`.
--   Noms exacts des policies (github history, create-bucket-*-temp) :
--     "Public Access for avatars" / "Public Upload for avatars" /
--     "Public Update for avatars" / "Public Delete for avatars"
--     "Public Access for files"   / "Public Upload for files"   /
--     "Public Update for files"   / "Public Delete for files"
--   (Buckets non utilisés par le client : les avatars vivent dans le dossier
--    `avatars/` du bucket `media`. Aucun flux ne dépend de ces buckets.)
--
-- Item #5 : résidu `media_insert_owner_or_group` / `media_update_owner_or_group`
--   (20260513_private_media_storage.sql) jamais supprimé par les migrations
--   scopées 20261027/20261028. Non scopé → on ne garde QUE les 4 policies
--   `media_*_scoped`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- #3a — buckets `avatars` / `files` en PRIVÉ
-- ---------------------------------------------------------------------------
UPDATE storage.buckets SET public = false WHERE id IN ('avatars', 'files');

-- ---------------------------------------------------------------------------
-- #3b — suppression des policies bucket-wide connues (avatars / files)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Access for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Update for avatars" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete for avatars" ON storage.objects;

DROP POLICY IF EXISTS "Public Access for files" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload for files" ON storage.objects;
DROP POLICY IF EXISTS "Public Update for files" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete for files" ON storage.objects;

-- Variante media créée par la même edge function (bucket-wide, tous rôles).
DROP POLICY IF EXISTS "Public Access for media" ON storage.objects;
DROP POLICY IF EXISTS "Public Upload for media" ON storage.objects;
DROP POLICY IF EXISTS "Public Update for media" ON storage.objects;
DROP POLICY IF EXISTS "Public Delete for media" ON storage.objects;

-- ---------------------------------------------------------------------------
-- #3c — purge DÉFENSIVE : toute policy storage visant explicitement les buckets
--        `avatars` ou `files` (quel que soit son nom) est supprimée.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects'
    LOOP
        IF coalesce(r.qual, '')       ~* 'bucket_id\s*=\s*''(avatars|files)'''
           OR coalesce(r.with_check, '') ~* 'bucket_id\s*=\s*''(avatars|files)''' THEN
            EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
        END IF;
    END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- #5 — résidus media non scopés : on ne garde que les policies `*_scoped`
-- ---------------------------------------------------------------------------

-- Résidus connus (noms exacts des migrations antérieures).
DROP POLICY IF EXISTS "media_insert_owner_or_group" ON storage.objects;
DROP POLICY IF EXISTS "media_update_owner_or_group" ON storage.objects;
DROP POLICY IF EXISTS "media_select_by_membership"  ON storage.objects;
DROP POLICY IF EXISTS "media_select_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "media_insert_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "media_update_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "media_delete_authenticated"  ON storage.objects;
DROP POLICY IF EXISTS "media_delete_owner"          ON storage.objects;
DROP POLICY IF EXISTS "Public media access"         ON storage.objects;
DROP POLICY IF EXISTS "Users can upload media"      ON storage.objects;
DROP POLICY IF EXISTS "Users can update media"      ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media"      ON storage.objects;
DROP POLICY IF EXISTS "Users can read media"        ON storage.objects;
DROP POLICY IF EXISTS "Users can upload their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own media" ON storage.objects;
DROP POLICY IF EXISTS "Users can view media in their conversations" ON storage.objects;

-- Purge défensive : toute policy `media*` qui n'est pas une des 4 policies
-- scopées est supprimée (les `*_scoped` sont créées par 20261027/20261028).
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename  = 'objects'
          AND policyname LIKE 'media%'
          AND policyname NOT IN (
              'media_select_scoped',
              'media_insert_scoped',
              'media_update_scoped',
              'media_delete_scoped'
          )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
    END LOOP;
END
$mig$;
