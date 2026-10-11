-- ============================================================================
-- 2026-10-28 — Storage `media` : INSERT / UPDATE restreints au périmètre réel
-- ============================================================================
-- AVANT (état prod vérifié) : les deux policies d'écriture du bucket `media`
-- étaient bucket-wide (tout compte authentifié pouvait écrire/écraser
-- n'importe quel objet) :
--   • media_insert_authenticated  FOR INSERT WITH CHECK (bucket_id = 'media')
--   • media_update_authenticated  FOR UPDATE USING/WITH CHECK (bucket_id = 'media')
--   (cf. 20260513_fix_rls_and_storage_policies.sql:37-45)
-- Le SELECT, lui, a déjà été resserré par 20261027_media_select_scoped.sql.
--
-- APRÈS : on ne remplace QUE INSERT et UPDATE par un périmètre dérivé des
-- conventions RÉELLES des chemins (preuves grep ci-dessous). DELETE
-- (`media_delete_owner`, scopé `foldername[1] = auth.uid()`) n'est pas
-- bucket-wide ; il est aligné sur le même périmètre par la migration sœur
-- 20261028_storage_media_delete_scoped.sql (policy `media_delete_scoped`).
--
-- ── Conventions de chemins `media` (PREUVES grep, avant écriture) ───────────
--   • avatars/<userId>/avatar-<ts>.<ext>        (profil)
--       → src/pages/SettingsPage.tsx:590  `avatars/${user.id}/avatar-${Date.now()}.${ext}`
--   • avatars/<conversationId>/avatar-<ts>.<ext> (avatar de conversation)
--       → src/components/ConversationInfo.tsx:420-421  `avatars/${conversationId}/...`
--   • groups/<convId>/avatar.<ext> / avatar-<ts>.<ext> (groupe)
--       → src/pages/GroupsPage.tsx:154  `groups/${conversation.id}/avatar.${ext}`
--       → src/components/GroupManagement.tsx:192  `groups/${conversationId}/avatar-${Date.now()}.${fileExt}`
--   • groups/new-<ts>/avatar.<ext>              (groupe pas encore créé)
--       → src/pages/GroupsPage.tsx:127  `groups/new-${Date.now()}/avatar.${ext}`
--   • restored/<userId>/...                     (médias restaurés d'une sauvegarde)
--       → src/lib/backupService.ts:547  `restored/${userId}/${Date.now()}_${randomString}.${ext}`
--   • <userId>/<images|videos|documents>/<ts>_<name>  (médias E2EE de conversation)
--       → src/components/MediaUploader.tsx:459,578,752,848  `${userId}/${folder}/...`
--       → src/components/DocumentPreview/DocumentThumbnail.tsx:114  `${userId}/thumbnails/...`
--   • <userId>/<ts>.<ext>                       (message vocal)
--       → src/pages/ChatViewPage.tsx:2399  `${user.id}/${Date.now()}.${extension}`
--
-- ── Périmètre autorisé (identique INSERT et UPDATE) ────────────────────────
--   • <uid>/…              → propriétaire : foldername[1] = auth.uid()
--   • restored/<uid>/…     → propriétaire : foldername[1]='restored' et foldername[2]=uid
--   • groups/<convId>/…    → membre de la conv, OU [2] non-UUID (groupe pas créé)
--   • avatars/…            → RESSERRÉ : foldername[2] = auth.uid() (avatar de
--                            profil) OU membre de la conv foldername[2] (avatar
--                            de conversation). On ne RIEN casse : les deux
--                            flux connus couvrent exactement ces deux cas.
--
-- Idempotente : DROP ... IF EXISTS puis CREATE. Helper `private.try_uuid`
-- garantit qu'aucun cast ::uuid ne s'applique à un segment non-UUID.
-- Aucun impact sur les chemins listés ci-dessus (tous couverts).
-- ============================================================================

-- 1) Helper de périmètre d'écriture (source unique pour INSERT et UPDATE).
--    SECURITY INVOKER : n'utilise que auth.uid() + les helpers private.*
--    (is_member_of_conv_text est lui-même SECURITY DEFINER pour lire
--    conversation_members, dont la RLS empêcherait la lecture directe).
create or replace function private.media_write_scope_ok(p_name text) returns boolean
language sql
stable
security invoker
set search_path to 'public', 'private' as $$
  select
    auth.uid() is not null
    and (
      -- <uid>/…
      (storage.foldername(p_name))[1] = auth.uid()::text
      -- restored/<uid>/…
      or (
        (storage.foldername(p_name))[1] = 'restored'
        and (storage.foldername(p_name))[2] = auth.uid()::text
      )
      -- groups/<convId>/… (membre) ou groups/<non-uuid>/… (groupe pas créé)
      or (
        (storage.foldername(p_name))[1] = 'groups'
        and (
          private.try_uuid((storage.foldername(p_name))[2]) is null
          or private.is_member_of_conv_text((storage.foldername(p_name))[2])
        )
      )
      -- avatars/<uid>/… (profil) ou avatars/<convId>/… (conversation : membre)
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

comment on function private.media_write_scope_ok(text) is
  'Périmètre d''écriture (INSERT/UPDATE) du bucket media : <uid>/…, restored/<uid>/…, groups/<convId|non-uuid>/…, avatars/<uid|convId membre>/…. SECURITY INVOKER, sans cast ::uuid non gardé (private.try_uuid).';

-- 2) Supprimer les policies bucket-wide (et toute variante d'un run partiel).
drop policy if exists media_insert_authenticated on storage.objects;
drop policy if exists media_update_authenticated on storage.objects;
drop policy if exists media_insert_scoped on storage.objects;
drop policy if exists media_update_scoped on storage.objects;

-- 3) INSERT scopé.
create policy media_insert_scoped on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  );

-- 4) UPDATE scopé : USING sur l'ancienne ligne, WITH CHECK sur la nouvelle.
--    (L'upsert Storage passe par INSERT ... ON CONFLICT DO UPDATE : les deux
--    prédicats autorisent le même périmètre.)
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
