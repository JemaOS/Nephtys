-- ============================================================================
-- 2026-07-11 — Planification de la purge de rétention (modèle WhatsApp)
-- ============================================================================
-- Un message LIVRÉ + LU et plus ancien que le délai de grâce (7 jours par
-- défaut) est supprimé définitivement du serveur (ligne + objet média) par
-- l'Edge Function `purge-relayed`. Les clients gardent leur copie locale
-- (historique durable IndexedDB) : le serveur ne conserve donc plus
-- l'historique ancien.
--
-- On planifie l'appel horaire via pg_cron + pg_net.
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

select cron.schedule(
  'nephtys-purge-relayed',
  '37 * * * *',
  $job$
  select net.http_post(
    url := 'https://imkfbalgviqeotpjogff.supabase.co/functions/v1/purge-relayed',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlta2ZiYWxndmlxZW90cGpvZ2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NjE2NjYsImV4cCI6MjA4MDAzNzY2Nn0.POv8NbJu6TefE1e-J-9L8m5QTSp41XXwsO2ck69GnYc'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);