-- ============================================================================
-- 2026-10-36 — Purge de rétention : jeton/URL via env, plus de secret en clair
-- ============================================================================
-- CONSTAT (audit sec24, item #6) : le job pg_cron `nephtys-purge-relayed`
-- (20261011_retention_purge_token.sql:16-31) embarque en CLAIR la clé anon
-- publique du projet dans l'en-tête `Authorization` (Bearer eyJ...). La clé
-- anon est certes publique côté client, mais l'écrire en clair dans une
-- migration la fige (rotation impossible sans réécrire l'historique) et duplique
-- un secret dans les sources. Le jeton `x-purge-token` est, lui, un simple
-- placeholder.
--
-- CORRECTIF : on (re)planifie le job en lisant les DEUX valeurs depuis des
-- réglages de base de données (GUC), avec un placeholder explicite en repli.
-- AUCUN secret n'est écrit en clair dans cette migration.
--
-- ── CONFIGURATION (à faire par l'opérateur / l'environnement) ──────────────
-- Les valeurs ne peuvent PAS être lues depuis l'env Deno (pg_cron s'exécute
-- dans Postgres). On les fournit via des réglages de base :
--
--   ALTER DATABASE postgres SET app.settings.supabase_anon_key   = '<ANON_KEY>';
--   ALTER DATABASE postgres SET app.settings.purge_cron_token    = '<PURGE_CRON_TOKEN>';
--
-- `PURGE_CRON_TOKEN` doit être IDENTIQUE à l'env `PURGE_CRON_TOKEN` de l'edge
-- function `purge-relayed` (supabase/functions/purge-relayed/index.ts:30).
-- Tant que ces réglages sont absents, `current_setting(..., true)` renvoie NULL
-- et le job envoie les placeholders `__SET_ANON_KEY_VIA_ENV__` /
-- `__SET_PURGE_TOKEN_VIA_ENV__` : l'appel échoue proprement (403/401) sans
-- jamais utiliser de secret codé en dur.
--
-- Idempotente : unschedule (best-effort) puis schedule.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- (Re)planifie la tâche sans échouer si elle existe déjà.
do $$
begin
  perform cron.unschedule('nephtys-purge-relayed');
exception when others then
  null;
end $$;

-- Les valeurs sont résolues à l'exécution par le job. AUCUN secret en clair :
--   • Authorization  ← app.settings.supabase_anon_key  (sinon placeholder)
--   • x-purge-token  ← app.settings.purge_cron_token   (sinon placeholder)
select cron.schedule(
  'nephtys-purge-relayed',
  '37 * * * *',
  $job$
  select net.http_post(
    url := 'https://imkfbalgviqeotpjogff.supabase.co/functions/v1/purge-relayed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
        'Bearer ' || coalesce(
          current_setting('app.settings.supabase_anon_key', true),
          '__SET_ANON_KEY_VIA_ENV__'
        ),
      'x-purge-token',
        coalesce(
          current_setting('app.settings.purge_cron_token', true),
          '__SET_PURGE_TOKEN_VIA_ENV__'
        )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
