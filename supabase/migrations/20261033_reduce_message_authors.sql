-- ============================================================================
-- 2026-10-33 — Réduire l'exposition de l'auteur réel d'un message
-- ============================================================================
-- PROBLÈME (audit) : `private.message_authors(message_id, author_id)` existe
-- pour AUTORISER l'édition / la suppression d'un message par son auteur réel,
-- car l'auteur n'est plus reconnaissable via `messages.sender_id` (aveuglé en
-- Phase 1c). Mais `author_id` stocke l'UUID BRUT : tout rôle capable de lire
-- la table (service_role, opérateur, export SQL, dashboard) apprend QUI a
-- écrit chaque message — exactement la métadonnée de graphe social que le
-- sealed sender cherche à retirer.
--
-- OBJECTIF : l'autorisation est indispensable, on la RE-CLÉE donc sur un
-- pseudo­nyme non réversible en pratique :
--     author_ref = hex(hmac_sha256(author_id::text, secret))
-- `secret` étant stocké dans une table privée verrouillée `private.app_secrets`.
--
-- RÉSULTAT :
--   • L'autorisation (trigger UPDATE `restrict_member_message_update`, helper
--     `is_message_author`, RPC `soft_delete_message` / `edit_message`) compare
--     désormais `author_ref` et NON PLUS `author_id`.
--   • Le trafic NOUVEAU ne stocke plus l'UUID brut (`author_id` reste NULL) :
--     un lecteur de `message_authors` ne voit qu'un pseudo­nyme opaque.
--   • Les lignes HISTORIQUES conservent leur `author_id` (aucune donnée n'est
--     détruite) : « réduction, pas élimination ».
--
-- LIMITE ASSUMÉE (documentée, non éliminée) : le secret est EN BASE. Un rôle
-- qui peut lire `private.app_secrets` (superuser ; service_role si un grant
-- explicite subsiste) peut recalculer la correspondance et donc « dé-anonymiser »
-- le pseudo­nyme. La table est verrouillée (RLS + REVOKE) pour retirer cet accès
-- à PUBLIC / anon / authenticated / service_role, mais un superuser garde la
-- lecture. C'est donc une RÉDUCTION du périmètre de fuite, pas une suppression :
-- une non-réversibilité réelle exigerait de garder le secret HORS base (KMS /
-- secret d'Edge Function) et de calculer l'HMAC côté applicatif.
--
-- PÉRIMÈTRE VÉRIFIÉ (grep `author_id` / `message_authors` sur toutes les
-- migrations) — tout consommateur est adapté ici ou est un backfill one-shot
-- déjà appliqué (`20261031_message_user_state.sql`, exécuté AVANT celle-ci :
-- sur base neuve comme en prod il lit encore author_id, qui est alors renseigné ;
-- aucune modification de cette migration appliquée n'est faite) :
--   • private.record_message_author()            (20261011)  -> adapté
--   • private.is_message_author(uuid)            (20261011)  -> adapté
--   • private.restrict_member_message_update()   (20261030)  -> adapté
--   • public.soft_delete_message(uuid)           (20261011)  -> adapté
--   • public.edit_message(uuid, text)            (20261011)  -> adapté
--
-- Idempotente : re-jouable sans régénérer le secret (ON CONFLICT DO NOTHING)
-- ni écraser les author_ref déjà calculés (backfill filtré sur IS NULL).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. pgcrypto (hmac / gen_random_bytes) — idempotent
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Table de secrets verrouillée
-- ---------------------------------------------------------------------------
create table if not exists private.app_secrets (
  id         text primary key,
  value      text not null,
  created_at timestamptz not null default now()
);

alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated, service_role;

comment on table private.app_secrets is
  'Secrets applicatifs côté serveur (ex. clé HMAC du pseudo­nyme d''auteur). '
  'Verrouillée : RLS sans policy + REVOKE PUBLIC/anon/authenticated/service_role. '
  'Reste lisible par le superuser (cf. limite documentée de 20261033).';

-- ---------------------------------------------------------------------------
-- 2. Secret HMAC (généré une seule fois, jamais régénéré)
-- ---------------------------------------------------------------------------
-- Le secret DOIT rester stable dans le temps : le régénérer invaliderait tous
-- les author_ref et casserait l'autorisation. D'où l'insertion conditionnelle.
do $mig$
declare
    v_pgcrypto_schema text;
begin
    select n.nspname into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pgcrypto';

    if v_pgcrypto_schema is null then
        raise exception 'pgcrypto introuvable : impossible de générer le secret HMAC';
    end if;

    -- gen_random_bytes est dans pgcrypto (schéma variable : public ou extensions) ;
    -- encode() est une fonction du noyau (pg_catalog).
    execute format(
        'insert into private.app_secrets (id, value) '
        'select %L, encode(%I.gen_random_bytes(32), %L) '
        'where not exists (select 1 from private.app_secrets where id = %L)',
        'message_author_hmac', v_pgcrypto_schema, 'hex', 'message_author_hmac'
    );
end
$mig$;

-- ---------------------------------------------------------------------------
-- 3. Helper : pseudonyme d'auteur (HMAC-SHA256, hex)
-- ---------------------------------------------------------------------------
-- `p_user IS NULL` -> NULL (aucun auteur : insertion système/service_role sans
-- session). SECURITY DEFINER + search_path figé : la clé n'est jamais exposée
-- à l'appelant, seul le digest l'est. EXECUTE révoqué : appelée uniquement
-- depuis les fonctions DEFINER ci-dessous (qui tournent en tant que owner).
create or replace function private.author_ref(p_user uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, private, extensions
as $function$
  select case
           when p_user is null then null
           else encode(
                  hmac(
                    p_user::text,
                    (select s.value
                       from private.app_secrets s
                      where s.id = 'message_author_hmac'),
                    'sha256'
                  ),
                  'hex'
                )
         end;
$function$;

revoke all on function private.author_ref(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Colonne pseudo­nyme + backfill
-- ---------------------------------------------------------------------------
alter table private.message_authors
    add column if not exists author_ref text;

comment on column private.message_authors.author_ref is
  'Pseudo­nyme HMAC-SHA256 (hex) de l''auteur réel, calculé via '
  'private.author_ref(). Base de l''autorisation depuis 20261033 : non '
  'réversible en pratique sans le secret de private.app_secrets.';

-- `author_id` conservé (nullable) pour la sûreté / les lignes historiques.
alter table private.message_authors
    alter column author_id drop not null;

comment on column private.message_authors.author_id is
  'UUID brut de l''auteur. LEGACY : renseigné uniquement pour le trafic '
  'antérieur à 20261033. NULL pour les nouveaux messages (seul author_ref est '
  'stocké). N''est plus utilisé par l''autorisation.';

-- Backfill des lignes existantes (idempotent : ne remplit que les NULL).
update private.message_authors
   set author_ref = private.author_ref(author_id)
 where author_ref is null
   and author_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Trigger d'enregistrement : n'écrit plus que le pseudo­nyme
-- ---------------------------------------------------------------------------
-- Les nouveaux messages n'exposent plus d'UUID brut : on renseigne author_ref
-- et on laisse author_id NULL (colonne nullable depuis l'étape 4).
create or replace function private.record_message_author()
returns trigger
language plpgsql
security definer
set search_path to 'public','private'
as $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO private.message_authors (message_id, author_ref)
    VALUES (NEW.id, private.author_ref(auth.uid()))
    ON CONFLICT (message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Helper d'autorisation (policies message_media_keys / message_text_keys)
-- ---------------------------------------------------------------------------
-- Même logique qu'avant, mais comparaison sur author_ref. Le repli
-- `sender_id = auth.uid()` reste dans les policies (cf. 20261011_e2ee_key_author_rls).
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
      and ma.author_ref is not null
      and ma.author_ref = private.author_ref(auth.uid())
  );
$function$;

-- Conserve le grant à `authenticated` : la fonction est évaluée par le planner
-- dans les policies RLS (cf. 20261012_rls_security_definer_hygiene.sql).
revoke all on function private.is_message_author(uuid) from public, anon, service_role;
grant execute on function private.is_message_author(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Trigger d'autorisation UPDATE (version 20261030, auteur via author_ref)
-- ---------------------------------------------------------------------------
-- Reprend la denylist COMPLÈTE de 20261030_audit_final_message_trigger.sql ; on
-- ne change QUE le test d'auteur : author_ref au lieu d'author_id.
create or replace function private.restrict_member_message_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  -- Auteur historique (sender_id encore renseigné) ou auteur réel (pseudo­nyme).
  IF OLD.sender_id = auth.uid() THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.message_authors ma
    WHERE ma.message_id = OLD.id
      AND ma.author_ref IS NOT NULL
      AND ma.author_ref = private.author_ref(auth.uid())
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.content             IS DISTINCT FROM OLD.content
     OR NEW.file_url         IS DISTINCT FROM OLD.file_url
     OR NEW.file_name        IS DISTINCT FROM OLD.file_name
     OR NEW.file_size        IS DISTINCT FROM OLD.file_size
     OR NEW.media_url        IS DISTINCT FROM OLD.media_url
     OR NEW.media_type       IS DISTINCT FROM OLD.media_type
     OR NEW.media_thumbnail  IS DISTINCT FROM OLD.media_thumbnail
     OR NEW.media_width      IS DISTINCT FROM OLD.media_width
     OR NEW.media_height     IS DISTINCT FROM OLD.media_height
     OR NEW.encryption_metadata IS DISTINCT FROM OLD.encryption_metadata
     OR NEW.is_text_encrypted   IS DISTINCT FROM OLD.is_text_encrypted
     OR NEW.is_media_encrypted  IS DISTINCT FROM OLD.is_media_encrypted
     OR NEW.link_preview     IS DISTINCT FROM OLD.link_preview
     OR NEW.deleted_at       IS DISTINCT FROM OLD.deleted_at
     OR NEW.is_deleted       IS DISTINCT FROM OLD.is_deleted
     OR NEW.edited_at        IS DISTINCT FROM OLD.edited_at
     OR NEW.is_edited        IS DISTINCT FROM OLD.is_edited
     OR NEW.sender_id        IS DISTINCT FROM OLD.sender_id
     OR NEW.conversation_id  IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_sealed    IS DISTINCT FROM OLD.sender_sealed
     OR NEW.sender_name      IS DISTINCT FROM OLD.sender_name
     OR NEW.sender_avatar    IS DISTINCT FROM OLD.sender_avatar
     OR NEW.profiles         IS DISTINCT FROM OLD.profiles
     OR NEW.reply_to_id      IS DISTINCT FROM OLD.reply_to_id
     OR NEW.type             IS DISTINCT FROM OLD.type
     OR NEW.is_ephemeral     IS DISTINCT FROM OLD.is_ephemeral
     OR NEW.ephemeral_duration    IS DISTINCT FROM OLD.ephemeral_duration
     OR NEW.ephemeral_expires_at  IS DISTINCT FROM OLD.ephemeral_expires_at THEN
    RAISE EXCEPTION 'Forbidden: only status may be changed by non-senders';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 8. RPC métier : autoriser l'auteur via author_ref
-- ---------------------------------------------------------------------------
create or replace function public.soft_delete_message(message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  UPDATE public.messages m
  SET deleted_at = NOW()
  WHERE m.id = message_id
    AND m.deleted_at IS NULL
    AND (
      m.sender_id = auth.uid()
      OR auth.role() = 'service_role'
      OR EXISTS (
        SELECT 1 FROM private.message_authors ma
        WHERE ma.message_id = m.id
          AND ma.author_ref IS NOT NULL
          AND ma.author_ref = private.author_ref(auth.uid())
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END;
$function$;

create or replace function public.edit_message(message_id uuid, new_content text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  UPDATE public.messages m
  SET content = new_content, edited_at = NOW(), is_edited = TRUE
  WHERE m.id = message_id
    AND m.deleted_at IS NULL
    AND (
      m.sender_id = auth.uid()
      OR auth.role() = 'service_role'
      OR EXISTS (
        SELECT 1 FROM private.message_authors ma
        WHERE ma.message_id = m.id
          AND ma.author_ref IS NOT NULL
          AND ma.author_ref = private.author_ref(auth.uid())
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END;
$function$;
