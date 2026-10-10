-- ============================================================================
-- P1 — Supabase comme RELAIS AVEUGLE (files anonymes, sans user_id)
-- ============================================================================
-- Objectif : faire fonctionner le mode privé anonyme SANS serveur relais en
-- plus, en utilisant Supabase comme simple transport à files opaques.
--
-- Principes (modèle SimpleX) :
--   • Aucune notion d'utilisateur : les tables ne contiennent AUCUN user_id.
--   • Chaque file a 2 jetons : send_token (déposer) et rcv_token (lire/ack).
--     Seuls les HASH des jetons sont stockés (pgcrypto), jamais en clair.
--   • Accès direct aux tables INTERDIT (RLS sans policy) → tout passe par des
--     fonctions SECURITY DEFINER qui valident le jeton côté serveur.
--   • Le ciphertext est déjà chiffré E2EE côté client : le serveur ne lit rien.
--
-- Résultat : Supabase ne voit que des `queue_id` opaques + du ciphertext →
-- le graphe social disparaît. (IP/timing restent visibles — atténués par la
-- rotation de files + le trafic de couverture côté client.)
-- ============================================================================

create extension if not exists pgcrypto;

-- ─── Tables ────────────────────────────────────────────────────────────────
create table if not exists public.anon_queues (
    queue_id        uuid primary key default gen_random_uuid(),
    send_token_hash text not null,
    rcv_token_hash  text not null,
    created_at      timestamptz not null default now()
);

create table if not exists public.anon_queue_messages (
    id         uuid primary key default gen_random_uuid(),
    queue_id   uuid not null references public.anon_queues(queue_id) on delete cascade,
    ciphertext text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '7 days')
);

create index if not exists idx_anon_queue_messages_queue
    on public.anon_queue_messages (queue_id, created_at);

-- ─── RLS : accès direct refuse (aucune policy) ─────────────────────────────
alter table public.anon_queues enable row level security;
alter table public.anon_queue_messages enable row level security;
revoke all on public.anon_queues from anon, authenticated;
revoke all on public.anon_queue_messages from anon, authenticated;

-- ─── Helpers ────────────────────────────────────────────────────────────────
-- (fonctions pgcrypto résolues via search_path = public, extensions)

-- ─── RPC : créer une file ───────────────────────────────────────────────────
create or replace function public.anon_queue_create()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_send text := encode(gen_random_bytes(18), 'base64');
    v_rcv  text := encode(gen_random_bytes(18), 'base64');
    v_qid  uuid;
begin
    insert into public.anon_queues (send_token_hash, rcv_token_hash)
    values (encode(digest(v_send, 'sha256'), 'hex'),
            encode(digest(v_rcv,  'sha256'), 'hex'))
    returning queue_id into v_qid;

    return jsonb_build_object('queueId', v_qid, 'sendToken', v_send, 'rcvToken', v_rcv);
end;
$$;

-- ─── RPC : déposer un message ───────────────────────────────────────────────
create or replace function public.anon_queue_send(
    p_queue_id   uuid,
    p_send_token text,
    p_ciphertext text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not exists (
        select 1 from public.anon_queues q
        where q.queue_id = p_queue_id
          and q.send_token_hash = encode(digest(p_send_token, 'sha256'), 'hex')
    ) then
        raise exception 'unauthorized';
    end if;

    delete from public.anon_queue_messages
     where queue_id = p_queue_id and expires_at < now();

    if (select count(*) from public.anon_queue_messages where queue_id = p_queue_id) >= 1000 then
        raise exception 'queue full';
    end if;

    insert into public.anon_queue_messages (queue_id, ciphertext)
    values (p_queue_id, p_ciphertext);

    return jsonb_build_object('ok', true);
end;
$$;

-- ─── RPC : lire les messages en attente ─────────────────────────────────────
create or replace function public.anon_queue_read(
    p_queue_id  uuid,
    p_rcv_token text,
    p_limit     int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_result jsonb;
begin
    if not exists (
        select 1 from public.anon_queues q
        where q.queue_id = p_queue_id
          and q.rcv_token_hash = encode(digest(p_rcv_token, 'sha256'), 'hex')
    ) then
        raise exception 'unauthorized';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id,
               'ciphertext', m.ciphertext,
               'ts', (extract(epoch from m.created_at) * 1000)::bigint
           )), '[]'::jsonb)
      into v_result
      from (
          select id, ciphertext, created_at
          from public.anon_queue_messages
          where queue_id = p_queue_id and expires_at > now()
          order by created_at asc
          limit greatest(1, least(p_limit, 500))
      ) m;

    return jsonb_build_object('messages', v_result);
end;
$$;

-- ─── RPC : acquitter (supprimer) des messages lus ───────────────────────────
create or replace function public.anon_queue_ack(
    p_queue_id  uuid,
    p_rcv_token text,
    p_ids       uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not exists (
        select 1 from public.anon_queues q
        where q.queue_id = p_queue_id
          and q.rcv_token_hash = encode(digest(p_rcv_token, 'sha256'), 'hex')
    ) then
        raise exception 'unauthorized';
    end if;

    delete from public.anon_queue_messages
     where queue_id = p_queue_id and id = any(p_ids);

    return jsonb_build_object('ok', true);
end;
$$;

-- ─── RPC : supprimer une file (fermeture) ───────────────────────────────────
create or replace function public.anon_queue_delete(
    p_queue_id  uuid,
    p_rcv_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
    if not exists (
        select 1 from public.anon_queues q
        where q.queue_id = p_queue_id
          and q.rcv_token_hash = encode(digest(p_rcv_token, 'sha256'), 'hex')
    ) then
        raise exception 'unauthorized';
    end if;

    delete from public.anon_queues where queue_id = p_queue_id;
    return jsonb_build_object('ok', true);
end;
$$;

-- ─── Droits d'exécution (RPC seulement) ─────────────────────────────────────
revoke all on function public.anon_queue_create() from public;
revoke all on function public.anon_queue_send(uuid, text, text) from public;
revoke all on function public.anon_queue_read(uuid, text, int) from public;
revoke all on function public.anon_queue_ack(uuid, text, uuid[]) from public;
revoke all on function public.anon_queue_delete(uuid, text) from public;

grant execute on function public.anon_queue_create() to anon, authenticated;
grant execute on function public.anon_queue_send(uuid, text, text) to anon, authenticated;
grant execute on function public.anon_queue_read(uuid, text, int) to anon, authenticated;
grant execute on function public.anon_queue_ack(uuid, text, uuid[]) to anon, authenticated;
grant execute on function public.anon_queue_delete(uuid, text) to anon, authenticated;
