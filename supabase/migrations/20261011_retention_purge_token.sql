-- ============================================================================
-- 2026-10-11 — Sécurise la purge de rétention (jeton partagé)
-- ============================================================================
-- La fonction `purge-relayed` exige désormais l'en-tête `x-purge-token`
-- (porteur de la clé anon publique = n'importe qui pouvait sinon déclencher la
-- purge). On republie le job pg_cron avec ce jeton.
-- ============================================================================

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
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlta2ZiYWxndmlxZW90cGpvZ2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0NjE2NjYsImV4cCI6MjA4MDAzNzY2Nn0.POv8NbJu6TefE1e-J-9L8m5QTSp41XXwsO2ck69GnYc',
      'x-purge-token', 'npt_purge_7f3c9a1b5e2d4c8f'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);