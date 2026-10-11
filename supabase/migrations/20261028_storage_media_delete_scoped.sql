-- ============================================================================
-- 2026-10-28 — Storage `media` : DELETE aligné sur le périmètre d'écriture
-- ============================================================================
-- PROBLÈME : `media_delete_owner` (DELETE) est scopée sur le SEUL préfixe
-- `<uid>/…` :
--   USING (bucket_id='media' AND (storage.foldername(name))[1] = auth.uid()::text)
--   (cf. 20260513_fix_rls_and_storage_policies.sql:47-53)
-- Elle empêche donc la suppression des :
--   • avatars/<userId|convId>/…   ([(foldername)[1]]='avatars' ≠ uid)
--   • groups/<convId|new-<ts>>/…  (foldername[1]='groups' ≠ uid)
-- ce qui casse le nettoyage réel de l'app :
--   → src/pages/GroupsPage.tsx:159  `remove([avatarPath])` sur `groups/new-<ts>/avatar.<ext>`
-- (les flux de suppression de médias de conversation `<uid>/…` restent couverts).
--
-- APRÈS : on remplace `media_delete_owner` par `media_delete_scoped`, de MÊME
-- périmètre que l'écriture (`private.media_write_scope_ok`), à savoir :
--   • <uid>/…              → propriétaire ;
--   • restored/<uid>/…     → propriétaire ;
--   • groups/<convId>/…    → membre de la conv, ou [2] non-UUID (groupe pas créé) ;
--   • avatars/<userId>/…   → propriétaire ; avatars/<convId>/… → membre de la conv.
--
-- ── PREUVES grep : aucun autre flux n'attend un DELETE plus large ──────────
-- Toutes les suppressions Storage `media` du code :
--   • src/pages/GroupsPage.tsx:159        `remove([avatarPath])`  → `groups/new-<ts>/…`   (couvert)
--   • src/pages/ChatViewPage.tsx:2680     `remove([filePath])`    → média de message `<uid>/…` (couvert)
--   • src/pages/ChatViewPage.tsx:3166     `remove(mediaFilePaths)`→ médias de messages `<uid>/…` (couvert)
-- Aucun `remove` sur `avatars/…`, `restored/…` ni sur `anon_files` dans le
-- client. `backupService.ts` ne supprime rien du Storage (`.remove()` y est un
-- ancrage DOM, ligne 480) ; `DocumentThumbnail.tsx` n'upload jamais de delete.
-- → Aucun flux n'exige un DELETE bucket-wide.
--
-- ── NOTE D'ORDRE ───────────────────────────────────────────────────────────
-- Tri lexicographique Supabase : `..._media_delete_scoped` s'exécute AVANT
-- `..._media_insert_update_scoped` (d < i). Pour rester indépendant de l'ordre,
-- cette migration (re)crée elle-même le helper `private.media_write_scope_ok`
-- (identité de corps avec l'autre migration). Idempotent.
-- ============================================================================

-- 1) Helper de périmètre (redéfini ici → ordre-indépendant ; miroir exact de
--    20261028_storage_media_insert_update_scoped.sql). SECURITY INVOKER.
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
  'Périmètre d''écriture/suppression du bucket media : <uid>/…, restored/<uid>/…, groups/<convId|non-uuid>/…, avatars/<uid|convId membre>/…. SECURITY INVOKER, sans cast ::uuid non gardé (private.try_uuid).';

-- 2) Remplacer la policy DELETE (idempotent : ancienne + variante partielle).
drop policy if exists media_delete_owner on storage.objects;
drop policy if exists media_delete_scoped on storage.objects;

create policy media_delete_scoped on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and private.media_write_scope_ok(name)
  );
