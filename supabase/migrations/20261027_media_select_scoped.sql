-- ============================================================================
-- 2026-10-27 — Storage `media` : SELECT restreint (fin de la fuite par bucket)
-- ============================================================================
-- La policy `media_select_authenticated` autorisait TOUT compte authentifié à
-- lire/lister TOUT le bucket `media` (nom de fichier, taille, horodatage,
-- dossier = uid de l'uploadeur). Le contenu est chiffré E2EE, mais les
-- MÉTADONNÉES fuyaient. On restreint la lecture aux objets légitimes :
--
--   • avatars/…            → tous les authentifiés (avatars de profil/conv) ;
--   • groups/<uuid>/…      → membres de la conversation ;
--   • groups/<non-uuid>/…  → tous (avatar de groupe temporaire avant création) ;
--   • restored/<uid>/…     → le propriétaire OU un pair partageant une conv ;
--   • <uid>/…              → le propriétaire OU un pair partageant une conv.
--
-- Helpers « à épreuve de cast » : les segments de chemin non-UUID ne doivent
-- jamais faire échouer un cast ::uuid (les OR ne garantissent pas le court-
-- circuit). Rétrocompatible et sans impact sur les flux existants (avatars,
-- avatars de groupe, médias E2EE de conversation, médias restaurés).
-- ============================================================================

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

drop policy if exists media_select_authenticated on storage.objects;
drop policy if exists media_select_scoped on storage.objects;
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