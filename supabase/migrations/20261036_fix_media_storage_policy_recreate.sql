-- ============================================================================
-- 2026-10-36 — Storage `media` : re-création propre des 4 policies scopées
-- ============================================================================
-- BUG SQL (audit sec24, item #5) : `20260513_fix_rls_and_storage_policies.sql`
-- référence une table INEXISTANTE `storage.policies` (ligne 25) :
--     FOR r IN SELECT policyname FROM storage.policies WHERE bucket_id = 'media'
-- Cette référence lève une erreur (`relation "storage.policies" does not
-- exist`) et empêche le bloc (et la suite du fichier) de s'exécuter
-- correctement sur un rejeu à froid. L'état final des policies du bucket
-- `media` dépend donc de l'ordre / d'une exécution partielle.
--
-- CORRECTIF : cette migration re-crée PROPREMENT l'état FINAL attendu du bucket
-- `media`, indépendamment de l'ordre :
--   • purge de TOUTE policy `media*` non scopée (bucket-wide / legacy) ;
--   • (re)définition idempotente des helpers de périmètre utilisés par les
--     policies (afin que la migration soit auto-suffisante même si les
--     migrations 20261027/20261028 n'ont pas tourné) ;
--   • (re)création des QUATRE policies scopées :
--       media_select_scoped, media_insert_scoped, media_update_scoped,
--       media_delete_scoped.
--
-- Ces corps sont des COPIES À L'IDENTIQUE de 20261027_media_select_scoped.sql
-- et 20261028_storage_media_*_scoped.sql : `CREATE OR REPLACE` ne change donc
-- rien quand elles ont déjà tourné.
--
-- Idempotente : DROP ... IF EXISTS + CREATE OR REPLACE + purge défensive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers de périmètre (identiques à 20261027 / 20261028).
-- ---------------------------------------------------------------------------
create or replace function private.try_uuid(p text) returns uuid
language sql immutable as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid else null end;
$$;
revoke all on function private.try_uuid(text) from public, anon;
grant execute on function private.try_uuid(text) to authenticated;

create or replace function private.is_member_of_conv_text(p text) returns boolean
language sql stable security definer set search_path to 'public','private' as $$
  select exists (select 1 from public.conversation_members cm
                 where cm.conversation_id = private.try_uuid(p) and cm.user_id = auth.uid());
$$;
revoke all on function private.is_member_of_conv_text(text) from public, anon;
grant execute on function private.is_member_of_conv_text(text) to authenticated;

create or replace function private.shares_conversation_with_text(p text) returns boolean
language sql stable security definer set search_path to 'public','private' as $$
  select exists (
    select 1 from public.conversation_members a
    join public.conversation_members b on a.conversation_id = b.conversation_id
    where a.user_id = auth.uid() and b.user_id = private.try_uuid(p)
  );
$$;
revoke all on function private.shares_conversation_with_text(text) from public, anon;
grant execute on function private.shares_conversation_with_text(text) to authenticated;

create or replace function private.media_write_scope_ok(p_name text) returns boolean
language sql
stable
security invoker
set search_path to 'public', 'private' as $$
  select
    auth.uid() is not null
    and (
      (storage.foldername(p_name))[1] = auth.uid()::text
      or (
        (storage.foldername(p_name))[1] = 'restored'
        and (storage.foldername(p_name))[2] = auth.uid()::text
      )
      or (
        (storage.foldername(p_name))[1] = 'groups'
        and (
          private.try_uuid((storage.foldername(p_name))[2]) is null
          or private.is_member_of_conv_text((storage.foldername(p_name))[2])
        )
      )
      or (
        (storage.foldername(p_name))[1] = 'avatars'
        and (
          (storage.foldername(p_name))[2] = auth.uid()::text
          or private.is_member_of_conv_text((storage.foldername(p_name))[2])
        )
      )
    );
$$;
revoke all on function private.media_write_scope_ok(text) from public, anon;
grant execute on function private.media_write_scope_ok(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 1) Purge défensive : toute policy `media%` non scopée est supprimée.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "media_select_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "media_insert_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "media_update_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "media_delete_authenticated"   ON storage.objects;
DROP POLICY IF EXISTS "media_insert_owner_or_group"  ON storage.objects;
DROP POLICY IF EXISTS "media_update_owner_or_group"  ON storage.objects;
DROP POLICY IF EXISTS "media_select_by_membership"   ON storage.objects;
DROP POLICY IF EXISTS "media_delete_owner"           ON storage.objects;
DROP POLICY IF EXISTS "Public media access"          ON storage.objects;
DROP POLICY IF EXISTS "Users can upload media"       ON storage.objects;
DROP POLICY IF EXISTS "Users can update media"       ON storage.objects;
DROP POLICY IF EXISTS "Users can delete media"       ON storage.objects;
DROP POLICY IF EXISTS "Users can read media"         ON storage.objects;

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

-- ---------------------------------------------------------------------------
-- 2) (Re)création des 4 policies scopées → état final déterministe.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS media_select_scoped ON storage.objects;
create policy media_select_scoped on storage.objects for select to authenticated
using (
  bucket_id = 'media' and (
    (storage.foldername(name))[1] = 'avatars'
    or ((storage.foldername(name))[1] = 'groups' and (
          private.try_uuid((storage.foldername(name))[2]) is null
          or private.is_member_of_conv_text((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = 'restored' and (
          (storage.foldername(name))[2] = auth.uid()::text
          or private.shares_conversation_with_text((storage.foldername(name))[2])))
    or ((storage.foldername(name))[1] = auth.uid()::text)
    or private.shares_conversation_with_text((storage.foldername(name))[1])
  )
);

DROP POLICY IF EXISTS media_insert_scoped ON storage.objects;
create policy media_insert_scoped on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  );

DROP POLICY IF EXISTS media_update_scoped ON storage.objects;
create policy media_update_scoped on storage.objects
  for update to authenticated
  using (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  )
  with check (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  );

DROP POLICY IF EXISTS media_delete_scoped ON storage.objects;
create policy media_delete_scoped on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  );
