-- Migration: Add reply_to support for messages
-- Description: Permet de répondre/citer des messages existants
-- Date: 2025-11-30

-- Add reply_to_id column to messages table
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON public.messages(reply_to_id);

-- Add comment
COMMENT ON COLUMN public.messages.reply_to_id IS 'ID du message auquel on répond (citation/reply)';