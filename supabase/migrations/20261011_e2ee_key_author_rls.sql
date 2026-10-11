-- ============================================================================
-- 2026-10-11 — Autorisation des clés E2EE (texte + média) via l'AUTEUR
-- ============================================================================
-- Depuis l'aveuglement de l'expéditeur, `messages.sender_id` est NULL pour les
-- inserts clients → la policy d'insertion de `message_media_keys` (qui exigeait
-- `m.sender_id = auth.uid()`) ne pouvait JAMAIS matcher : les clés média
-- n'étaient pas stockées et les médias chiffrés étaient indéchiffrables.
--
-- On autorise l'AUTEUR réel via une fonction SECURITY DEFINER `is_message_author`
-- (la table `private.message_authors` n'est pas lisible par les clients : le
-- serveur reste aveugle, et un membre non-auteur ne peut pas injecter une clé
-- dans le message d'autrui).
-- ============================================================================

create or replace function private.is_message_author(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public','private'
as $function$
  select exists (
    select 1
    from private.message_authors ma
    where ma.message_id = p_message_id
      and ma.author_id = auth.uid()
  );
$function$;

revoke all on function private.is_message_author(uuid) from public;
grant execute on function private.is_message_author(uuid) to authenticated;

-- ── message_media_keys ────────────────────────────────────────────────────
drop policy if exists mmk_insert_sender on public.message_media_keys;
create policy mmk_insert_sender on public.message_media_keys
  for insert to authenticated
  with check (exists (
    select 1 from public.messages m
    where m.id = message_media_keys.message_id
      and (m.sender_id = auth.uid() or private.is_message_author(m.id))
  ));

drop policy if exists mmk_delete_sender on public.message_media_keys;
create policy mmk_delete_sender on public.message_media_keys
  for delete to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_media_keys.message_id
      and (m.sender_id = auth.uid() or private.is_message_author(m.id))
  ));

-- ── message_text_keys ─────────────────────────────────────────────────────
-- Remplace l'autorisation « membre de la conversation » par « auteur du
-- message » : un pair ne peut plus injecter/altérer la clé d'un message qu'il
-- n'a pas envoyé.
drop policy if exists mtk_insert_sender on public.message_text_keys;
create policy mtk_insert_sender on public.message_text_keys
  for insert to authenticated
  with check (exists (
    select 1 from public.messages m
    where m.id = message_text_keys.message_id
      and (m.sender_id = auth.uid() or private.is_message_author(m.id))
  ));

drop policy if exists mtk_delete_sender on public.message_text_keys;
create policy mtk_delete_sender on public.message_text_keys
  for delete to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_text_keys.message_id
      and (m.sender_id = auth.uid() or private.is_message_author(m.id))
  ));