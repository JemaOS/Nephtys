-- ============================================================================
-- 2026-10-35 — Anonymiser l'historique d'appels (public.call_logs)
-- ============================================================================
-- PROBLÈME (audit) : `public.call_logs` stockait `caller_id` / `callee_id` — les
-- UUID BRUTS des profils — ainsi que `duration`. Le serveur (service_role,
-- opérateur, dashboard, export SQL, réplication) pouvait donc reconstruire le
-- GRAPHE D'APPELS (qui a appelé qui, quand, combien de temps) : exactement la
-- métadonnée de graphe social que le reste du durcissement (sealed sender,
-- pseudonyme `author_ref` de 20261033) cherche à retirer.
--
-- OBJECTIF : le trafic NOUVEAU ne stocke PLUS aucun UUID de profil. Les colonnes
-- `caller_id` / `callee_id` gardent leur NOM (le client, `CallsPage` et
-- `ChatViewPage` comparent `caller_id === callee_id` pour reconnaître un appel
-- de groupe) mais contiennent désormais un PSEUDONYME :
--     user_ref(u) = truncate16(hmac_sha256(u::text, secret))::uuid
-- Le `secret` vit dans la table verrouillée `private.app_secrets`, comme pour
-- `message_authors.author_ref`.
--
--   • Plus aucun UUID de profil dans call_logs (ni caller ni callee).
--   • Les lignes HISTORIQUES sont RE-CLÉES : le backfill ÉCRASE la valeur en
--     clair par le pseudonyme (purge du plaintext, « réduction » à la 20261033).
--   • `conversation_id`, `type`, `status`, `started_at`, `ended_at` et
--     `duration` sont conservés (métadonnées minimales pour l'affichage local).
--
-- LIMITE ASSUMÉE (documentée, non éliminée) : le secret est EN BASE. Un rôle
-- capable de lire `private.app_secrets` (superuser ; service_role si un grant
-- explicite subsiste) peut recalculer la correspondance en énumérant
-- `profiles.id`. RÉDUCTION du périmètre de fuite, pas suppression : le
-- serveur « à la PostgREST » ne voit plus que des pseudonymes opaques.
--
-- IDEMPOTENTE : `if not exists`, secret jamais régénéré, backfill filtré sur
-- les lignes pointant ENCORE vers un profil réel (un pseudonyme ne correspond à
-- aucun `profiles.id`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. pgcrypto + table de secrets (idempotent — déjà créée par 20261033)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

create table if not exists private.app_secrets (
  id         text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Secret HMAC dédié aux appels (généré une seule fois, jamais régénéré)
-- ---------------------------------------------------------------------------
-- Secret DISTINCT de `message_author_hmac` : le pseudonyme d'un même profil
-- n'est pas corrélé entre `message_authors` et `call_logs`.
do $mig$
declare
    v_pgcrypto_schema text;
begin
    select n.nspname into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto';

    if v_pgcrypto_schema is null then
        raise exception 'pgcrypto introuvable : impossible de générer le secret HMAC des appels';
    end if;

    execute format(
        'insert into private.app_secrets (id, value) '
        'select %L, encode(%I.gen_random_bytes(32), %L) '
        'where not exists (select 1 from private.app_secrets where id = %L)',
        'call_logs_user_hmac', v_pgcrypto_schema, 'hex', 'call_logs_user_hmac'
    );
end
$mig$;

-- ---------------------------------------------------------------------------
-- 2. Pseudonyme d'utilisateur — HMAC-SHA256 tronqué à 16 octets, format UUID
-- ---------------------------------------------------------------------------
-- On garde le TYPE `uuid` des colonnes (index, comparaisons d'égalité et le
-- marqueur « groupe » `caller_id = callee_id` continuent de fonctionner sans
-- changer le type). Le pseudonyme n'est pas réversible sans le secret.
create or replace function private.user_ref(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
  select case
           when p_user is null then null
           else (
             substr(h, 1, 8)  || '-' || substr(h, 9, 4)  || '-' ||
             substr(h, 13, 4) || '-' || substr(h, 17, 4) || '-' ||
             substr(h, 21, 12)
           )::uuid
         end
  from (
    select encode(
             hmac(
               p_user::text,
               (select s.value from private.app_secrets s where s.id = 'call_logs_user_hmac'),
               'sha256'
             ),
             'hex'
           ) as h
  ) t;
$function$;

revoke all on function private.user_ref(uuid) from public, anon, authenticated, service_role;

comment on function private.user_ref(uuid) is
  'Pseudonyme UUID non réversible en pratique (HMAC-SHA256 tronqué à 16 octets) '
  'd''un profil, dérivé du secret privé call_logs_user_hmac. Remplace les UUID '
  'bruts de call_logs.caller_id/callee_id depuis 20261035.';

-- ---------------------------------------------------------------------------
-- 3. Rendre les colonnes nullables, retirer les FK, backfill (purge du clair)
-- ---------------------------------------------------------------------------
alter table public.call_logs alter column caller_id drop not null;
alter table public.call_logs alter column callee_id drop not null;

-- Les FK vers public.profiles empêchent d'y écrire un pseudonyme : on les retire.
do $mig$
declare
    r record;
    v_caller_attnum smallint;
    v_callee_attnum smallint;
begin
    select attnum into v_caller_attnum
      from pg_attribute
     where attrelid = 'public.call_logs'::regclass and attname = 'caller_id';
    select attnum into v_callee_attnum
      from pg_attribute
     where attrelid = 'public.call_logs'::regclass and attname = 'callee_id';

    for r in
        select conname
          from pg_constraint
         where conrelid = 'public.call_logs'::regclass
           and contype = 'f'
           and (conkey = array[v_caller_attnum] or conkey = array[v_callee_attnum])
    loop
        execute format('alter table public.call_logs drop constraint %I', r.conname);
    end loop;
end
$mig$;

-- Backfill : ÉCRASE l'UUID en clair par le pseudonyme. Idempotent : ne traite
-- que les lignes dont la valeur correspond ENCORE à un profil réel.
update public.call_logs c
   set caller_id = private.user_ref(c.caller_id)
 where c.caller_id is not null
   and exists (select 1 from public.profiles p where p.id = c.caller_id);

update public.call_logs c
   set callee_id = private.user_ref(c.callee_id)
 where c.callee_id is not null
   and exists (select 1 from public.profiles p where p.id = c.callee_id);

comment on column public.call_logs.caller_id is
  'Pseudonyme (private.user_ref) de l''initiateur de l''appel — plus d''UUID brut. '
  'NULL autorisé. Pour un appel de groupe, caller_id = callee_id (initiateur).';
comment on column public.call_logs.callee_id is
  'Pseudonyme (private.user_ref) du destinataire de l''appel — plus d''UUID brut. '
  'NULL autorisé. Pour un appel de groupe, caller_id = callee_id (initiateur).';

-- ---------------------------------------------------------------------------
-- 4. Trigger d'insertion : pseudo­nymise côté serveur (le client n'envoie plus
--    d'identité)
-- ---------------------------------------------------------------------------
-- Le client poste uniquement { conversation_id, type, status } (+ métadonnées).
-- Le trigger dérive les pseudonymes :
--   • groupe / pas de pair  → caller_id = callee_id = user_ref(auteur)
--   • ligne « answered » (créée par le RÉPONDEUR) → caller = pair, callee = auteur
--   • sinon (créée par l'APPELANT)                → caller = auteur, callee = pair
-- `status` distingue déjà les deux lignes d'un appel 1:1 répondru (le client
-- insère 'initiated' côté appelant et 'answered' côté répondant).
create or replace function private.set_call_log_refs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
    v_uid      uuid := auth.uid();
    v_conv_type text;
    v_peer     uuid;
    v_self_ref uuid;
begin
    -- Insertion système / service_role (pas de session) : on laisse tel quel.
    if v_uid is null then
        return new;
    end if;

    v_self_ref := private.user_ref(v_uid);

    select c.type into v_conv_type
      from public.conversations c
     where c.id = new.conversation_id;

    select cm.user_id into v_peer
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> v_uid
     limit 1;

    if v_conv_type = 'group' or v_peer is null then
        -- Appel de groupe (ou conversation sans pair) : l'initiateur est
        -- l'appelant ; caller_id = callee_id conserve le marqueur « groupe ».
        new.caller_id := v_self_ref;
        new.callee_id := v_self_ref;
    elsif new.status = 'answered' then
        new.caller_id := private.user_ref(v_peer);
        new.callee_id := v_self_ref;
    else
        new.caller_id := v_self_ref;
        new.callee_id := private.user_ref(v_peer);
    end if;

    return new;
end;
$function$;

revoke all on function private.set_call_log_refs() from public, anon, authenticated, service_role;

drop trigger if exists trg_call_logs_refs on public.call_logs;
create trigger trg_call_logs_refs
    before insert on public.call_logs
    for each row execute function private.set_call_log_refs();

-- ---------------------------------------------------------------------------
-- 5. RPC : pseudonyme de l'utilisateur courant (pour l'affichage « sortant »
--    côté client, sans jamais exposer private.user_ref)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_ref()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $function$
  select private.user_ref(auth.uid());
$function$;

revoke all on function public.current_user_ref() from public, anon;
grant execute on function public.current_user_ref() to authenticated;

comment on function public.current_user_ref() is
  'Pseudonyme (private.user_ref) de l''utilisateur authentifié courant. Permet '
  'au client de savoir si un appel est sortant (caller_id = mon pseudonyme) sans '
  'exposer le pseudonyme des autres ni la fonction de dérivation.';

-- ---------------------------------------------------------------------------
-- 6. RLS : les policies ne peuvent plus s'appuyer sur caller_id = auth.uid()
--    (la colonne n'est plus un UUID de profil). Portée = membre de la
--    conversation.
-- ---------------------------------------------------------------------------
drop policy if exists "call_logs_insert_caller" on public.call_logs;
create policy "call_logs_insert_member"
    on public.call_logs for insert
    to authenticated
    with check (private.is_conversation_member(conversation_id));

drop policy if exists "call_logs_update_caller" on public.call_logs;
create policy "call_logs_update_member"
    on public.call_logs for update
    to authenticated
    using (private.is_conversation_member(conversation_id))
    with check (private.is_conversation_member(conversation_id));

-- Ajoute la policy DELETE manquante : l'UI propose déjà « effacer l'appel »,
-- jusqu'ici silencieusement bloqué faute de policy.
drop policy if exists "call_logs_delete_member" on public.call_logs;
create policy "call_logs_delete_member"
    on public.call_logs for delete
    to authenticated
    using (private.is_conversation_member(conversation_id));
