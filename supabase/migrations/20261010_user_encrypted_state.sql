-- ============================================================================
-- P4 — Synchro chiffrée multi-appareil (foundation)
-- ============================================================================
-- Table générique « état chiffré » par utilisateur : le client y range des
-- blobs DÉJÀ chifrés côté client (clé dérivée du mot de passe) : bundle de
-- clés E2EE, historique, réglages… Le serveur ne voit que du ciphertext opaque.
--
-- Accès strictement propriétaire (RLS user_id = auth.uid()). Aucun autre
-- utilisateur ne peut lire/écrire. Fondation pour lier un 2e appareil : il
-- récupère ces blobs et les déchiffre avec le mot de passe (aucun service en
-- plus, réutilise Supabase).
-- ============================================================================

create table if not exists public.user_encrypted_state (
    user_id    uuid not null references auth.users(id) on delete cascade,
    key        text not null,
    blob       text not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, key)
);

alter table public.user_encrypted_state enable row level security;

drop policy if exists "ues_select_own" on public.user_encrypted_state;
create policy "ues_select_own" on public.user_encrypted_state
    for select to authenticated using (user_id = auth.uid());

drop policy if exists "ues_insert_own" on public.user_encrypted_state;
create policy "ues_insert_own" on public.user_encrypted_state
    for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "ues_update_own" on public.user_encrypted_state;
create policy "ues_update_own" on public.user_encrypted_state
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "ues_delete_own" on public.user_encrypted_state;
create policy "ues_delete_own" on public.user_encrypted_state
    for delete to authenticated using (user_id = auth.uid());
