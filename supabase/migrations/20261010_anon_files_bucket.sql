-- ============================================================================
-- P3 — Bucket Storage « opaque » (fondation, type XFTP)
-- ============================================================================
-- Bucket privé dédié aux fichiers chiffrés E2EE du mode privé. Le client
-- nomme les fichiers par un HASH ALÉATOIRE (capacité) et les uploade chunk par
-- chunk : côté serveur, le fichier n'est rattaché à AUCUNE conversation.
-- Réutilise Supabase Storage (aucun service en plus).
--
-- ⚠️ Fondation : le câblage (upload/téléchargement par chunks dans le chat
-- privé) est la phase suivante. Ici on crée le bucket + les accès.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('anon_files', 'anon_files', false)
on conflict (id) do nothing;

-- Accès authentifié uniquement (aperçu anonyme complet = phase ultérieure avec
-- relais de fichiers dédié). Pas de rattachement à une conversation côté app.
drop policy if exists "anon_files_insert" on storage.objects;
create policy "anon_files_insert" on storage.objects
    for insert to authenticated
    with check (bucket_id = 'anon_files');

drop policy if exists "anon_files_select" on storage.objects;
create policy "anon_files_select" on storage.objects
    for select to authenticated
    using (bucket_id = 'anon_files');

drop policy if exists "anon_files_delete" on storage.objects;
create policy "anon_files_delete" on storage.objects
    for delete to authenticated
    using (bucket_id = 'anon_files');
