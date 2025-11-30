-- Migration: Fix existing conversations without last_message_at
-- Description: Met à jour les conversations existantes pour ajouter last_message_at
-- Date: 2025-11-30

-- Update conversations without last_message_at to use created_at
UPDATE public.conversations
SET last_message_at = created_at
WHERE last_message_at IS NULL;

-- Add a trigger to automatically set last_message_at on conversation creation
CREATE OR REPLACE FUNCTION set_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_message_at IS NULL THEN
    NEW.last_message_at := NEW.created_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_conversation_last_message_at ON public.conversations;
CREATE TRIGGER trigger_set_conversation_last_message_at
  BEFORE INSERT ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION set_conversation_last_message_at();