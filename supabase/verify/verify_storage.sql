-- ============================================================================
-- Vérification Storage — À EXÉCUTER SUR LA BASE DÉPLOYÉE (LECTURE SEULE)
-- ============================================================================
-- Cible les correctifs 20261028_storage_* (media INSERT/UPDATE scopés,
-- anon_files : bucket privé + fin de l'énumération).
--
-- Exécution :
--   npx supabase@latest db query --linked --file supabase/verify/verify_storage.sql
-- ou via l'éditeur SQL du dashboard.
--
-- Chaque requête est annotée de son résultat ATTENDU. Les policies Storage
-- vivent dans pg_policies (schemaname='storage', tablename='objects').
-- ============================================================================

-- 1) Policies INSERT/UPDATE du bucket `media`.
--    ATTENDU : media_insert_scoped et media_update_scoped présentes, avec un
--    `with_check`/`qual` qui référence le périmètre (auth.uid / media_write_scope_ok)
--    et NON le simple `bucket_id = 'media'`.
SELECT policyname, cmd, roles::text AS roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'media_%'
ORDER BY cmd, policyname;

-- 2) Résidu bucket-wide interdit : aucune policy INSERT/UPDATE sur `media`
--    dont le prédicat ne contiendrait QUE le bucket (sans scope uid/membre).
--    Heuristique : porte sur `media` mais ne mentionne ni auth.uid ni le
--    helper de périmètre. ATTENDU : 0 ligne.
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd IN ('INSERT', 'UPDATE')
  AND coalesce(with_check, qual) ILIKE '%bucket_id = ''media''%'
  AND coalesce(with_check, qual) NOT ILIKE '%auth.uid%'
  AND coalesce(with_check, qual) NOT ILIKE '%media_write_scope_ok%'
ORDER BY policyname;

-- 3) Les anciennes policies non scopées ne doivent plus exister.
--    ATTENDU : 0 ligne
--    (media_insert_authenticated / media_update_authenticated / media_delete_owner).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname IN ('media_insert_authenticated', 'media_update_authenticated',
                     'media_delete_owner')
ORDER BY policyname;

-- 3b) DELETE `media` scopé : la policy doit référencer le périmètre
--     (auth.uid / media_write_scope_ok), y compris pour avatars/groupes.
--     ATTENDU : 1 ligne `media_delete_scoped`, qual contenant le scope.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd = 'DELETE' AND qual LIKE '%media%'
ORDER BY policyname;

-- 3c) Résidu DELETE bucket-only interdit sur `media` (sans scope).
--     ATTENDU : 0 ligne.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND cmd = 'DELETE'
  AND qual ILIKE '%bucket_id = ''media''%'
  AND qual NOT ILIKE '%auth.uid%'
  AND qual NOT ILIKE '%media_write_scope_ok%'
ORDER BY policyname;

-- 4) anon_files : la policy SELECT bucket-wide doit être ABSENTE (fin de
--    l'énumération). ATTENDU : 0 ligne.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (policyname = 'anon_files_select'
       OR (cmd = 'SELECT' AND qual LIKE '%anon_files%'))
ORDER BY policyname;

-- 5) anon_files : INSERT/DELETE toujours présents (upload/cleanup nécessaires).
--    ATTENDU : 2 lignes (anon_files_insert, anon_files_delete).
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'anon_files_%'
ORDER BY policyname;

-- 6) anon_files : bucket PRIVÉ. ATTENDU : public = false.
SELECT id, name, public
FROM storage.buckets
WHERE id = 'anon_files';

-- 7) Régression : le bucket `media` reste privé. ATTENDU : public = false.
SELECT id, name, public
FROM storage.buckets
WHERE id = 'media';

-- 8) Helper de périmètre : existe, SECURITY INVOKER, non exécutable par anon.
--    ATTENDU : security_definer = false, anon_can_execute = false,
--              auth_can_execute = true.
SELECT p.proname,
       p.prosecdef                                                AS security_definer,
       p.proconfig                                                AS settings,
       has_function_privilege('anon', p.oid, 'EXECUTE')           AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE')  AS auth_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'private' AND p.proname = 'media_write_scope_ok';

-- 9) Fuite générique : aucune policy Storage lisible par anon/public.
--    ATTENDU : 0 ligne.
SELECT policyname, cmd, roles::text AS roles
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND roles && ARRAY['anon', 'public']::name[]
ORDER BY policyname;

-- ============================================================================
-- 10) Vérifications des correctifs 20261030_audit_final_storage (après)
-- ============================================================================

-- 10a) buckets `avatars` / `files` PRIVÉS. ATTENDU : public = false.
SELECT id, name, public
FROM storage.buckets
WHERE id IN ('avatars', 'files')
ORDER BY id;

-- 10b) AUCUNE policy Storage ne doit viser les buckets avatars/files
--      (bucket-wide connues des edge functions « temp »). ATTENDU : 0 ligne.
SELECT policyname, cmd, roles::text AS roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND (
    qual       ~* 'bucket_id\s*=\s*''(avatars|files)'''
    OR with_check ~* 'bucket_id\s*=\s*''(avatars|files)'''
  )
ORDER BY policyname;

-- 10c) Résidus media NON scopés interdits. ATTENDU : 0 ligne.
--      (media_insert_owner_or_group / media_update_owner_or_group /
--       media_*_authenticated / media_select_by_membership / media_delete_owner).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname IN (
    'media_insert_owner_or_group','media_update_owner_or_group',
    'media_select_authenticated','media_insert_authenticated',
    'media_update_authenticated','media_delete_authenticated',
    'media_select_by_membership','media_delete_owner',
    'Public media access','Users can upload media','Users can update media',
    'Users can delete media','Users can read media'
  )
ORDER BY policyname;

-- 10d) Policies media restantes : doivent être EXACTEMENT les 4 scopées.
--      ATTENDU : 4 lignes (media_select_scoped, media_insert_scoped,
--      media_update_scoped, media_delete_scoped).
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE 'media%'
ORDER BY policyname;
-- ============================================================================
