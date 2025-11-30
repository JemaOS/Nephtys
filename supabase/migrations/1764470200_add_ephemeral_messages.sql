-- Migration: Add ephemeral messages support
-- Description: Permet de créer des messages éphémères qui s'auto-détruisent
-- Date: 2025-11-30

-- Add ephemeral columns to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS is_ephemeral BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS ephemeral_duration INTEGER, -- Durée en secondes (ex: 86400 pour 24h)
ADD COLUMN IF NOT EXISTS ephemeral_expires_at TIMESTAMPTZ;

-- Create index for performance on ephemeral messages
CREATE INDEX IF NOT EXISTS idx_messages_ephemeral_expires_at 
ON public.messages(ephemeral_expires_at) 
WHERE is_ephemeral = TRUE AND deleted_at IS NULL;

-- Add comments
COMMENT ON COLUMN public.messages.is_ephemeral IS 'Indique si le message est éphémère (auto-destruction)';
COMMENT ON COLUMN public.messages.ephemeral_duration IS 'Durée de vie du message en secondes';
COMMENT ON COLUMN public.messages.ephemeral_expires_at IS 'Date/heure d''expiration du message éphémère';

-- Function to auto-delete expired ephemeral messages
CREATE OR REPLACE FUNCTION delete_expired_ephemeral_messages()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messages
  SET deleted_at = NOW()
  WHERE is_ephemeral = TRUE
    AND ephemeral_expires_at IS NOT NULL
    AND ephemeral_expires_at <= NOW()
    AND deleted_at IS NULL;
END;
$$;

-- Note: Pour exécuter automatiquement cette fonction, vous devrez configurer
-- un cron job avec pg_cron ou utiliser un service externe
-- Exemple avec pg_cron (si disponible):
-- SELECT cron.schedule('delete-expired-messages', '*/5 * * * *', 'SELECT delete_expired_ephemeral_messages()');