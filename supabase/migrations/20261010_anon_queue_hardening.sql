-- ============================================================================
-- Durcissement du relais anonyme (anti-DoS) — 20261010
-- ============================================================================
-- Le relais anonyme n'a pas d'identité (par conception) : pas de rate-limit par
-- utilisateur possible sans IP. On borne donc globalement la création de files et
-- la taille des ciphertexts.
--   • anon_queue_create : au plus 300 créations / minute (compteur global),
--     nettoyage paresseux des compteurs > 1 h.
--   • anon_queue_send   : ciphertext plafonné à 256 Ko.
-- Signatures et logique inchangées par ailleurs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anon_queue_create()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
    v_send text := encode(gen_random_bytes(18), 'base64');
    v_rcv  text := encode(gen_random_bytes(18), 'base64');
    v_qid  uuid;
begin
    delete from public.auth_rate_limits
     where action = 'anon_queue_create' and attempted_at < now() - interval '1 hour';

    if (select count(*) from public.auth_rate_limits
          where action = 'anon_queue_create' and attempted_at > now() - interval '1 minute') >= 300 then
        raise exception 'rate limit exceeded';
    end if;
    insert into public.auth_rate_limits (key_type, key_value, action, success)
    values ('anon', 'global', 'anon_queue_create', true);

    insert into public.anon_queues (send_token_hash, rcv_token_hash)
    values (encode(digest(v_send, 'sha256'), 'hex'),
            encode(digest(v_rcv,  'sha256'), 'hex'))
    returning queue_id into v_qid;
    return jsonb_build_object('queueId', v_qid, 'sendToken', v_send, 'rcvToken', v_rcv);
end; $function$;

CREATE OR REPLACE FUNCTION public.anon_queue_send(p_queue_id uuid, p_send_token text, p_ciphertext text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
    if not exists (select 1 from public.anon_queues q
        where q.queue_id = p_queue_id and q.send_token_hash = encode(digest(p_send_token,'sha256'),'hex')) then
        raise exception 'unauthorized';
    end if;
    if p_ciphertext is null or length(p_ciphertext) > 262144 then
        raise exception 'ciphertext too large';
    end if;
    delete from public.anon_queue_messages where queue_id = p_queue_id and expires_at < now();
    if (select count(*) from public.anon_queue_messages where queue_id = p_queue_id) >= 1000 then
        raise exception 'queue full';
    end if;
    insert into public.anon_queue_messages (queue_id, ciphertext) values (p_queue_id, p_ciphertext);
    return jsonb_build_object('ok', true);
end; $function$;
