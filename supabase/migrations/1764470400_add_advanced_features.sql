-- Migration: Add advanced features (archive, pin, mute, edit, delete)
-- Description: Fonctionnalités avancées de gestion des conversations et messages
-- Date: 2025-11-30

-- Add columns to conversations table
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT FALSE;

-- Add columns to conversation_members table
ALTER TABLE public.conversation_members
ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- Add columns to messages table for editing
ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_edited BOOLEAN DEFAULT FALSE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON public.conversations(is_archived);
CREATE INDEX IF NOT EXISTS idx_conversations_pinned ON public.conversations(is_pinned);
CREATE INDEX IF NOT EXISTS idx_conversation_members_muted ON public.conversation_members(is_muted);
CREATE INDEX IF NOT EXISTS idx_messages_edited ON public.messages(is_edited) WHERE is_edited = TRUE;

-- Add comments
COMMENT ON COLUMN public.conversations.is_archived IS 'Conversation archivée (masquée de la liste principale)';
COMMENT ON COLUMN public.conversations.is_pinned IS 'Conversation épinglée en haut de la liste';
COMMENT ON COLUMN public.conversation_members.is_muted IS 'Notifications désactivées pour ce membre';
COMMENT ON COLUMN public.conversation_members.muted_until IS 'Date jusqu''à laquelle les notifications sont désactivées';
COMMENT ON COLUMN public.messages.edited_at IS 'Date de la dernière modification du message';
COMMENT ON COLUMN public.messages.is_edited IS 'Indique si le message a été modifié';

-- Function to soft delete messages (update deleted_at instead of hard delete)
CREATE OR REPLACE FUNCTION soft_delete_message(message_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messages
  SET deleted_at = NOW()
  WHERE id = message_id
    AND deleted_at IS NULL;
END;
$$;

-- Function to edit message
CREATE OR REPLACE FUNCTION edit_message(message_id UUID, new_content TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messages
  SET 
    content = new_content,
    edited_at = NOW(),
    is_edited = TRUE
  WHERE id = message_id
    AND deleted_at IS NULL;
END;
$$;

-- Function to pin/unpin message
CREATE OR REPLACE FUNCTION toggle_message_pin(message_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.messages
  SET is_pinned = NOT is_pinned
  WHERE id = message_id;
END;
$$;

COMMENT ON FUNCTION soft_delete_message IS 'Supprime un message (soft delete)';
COMMENT ON FUNCTION edit_message IS 'Modifie le contenu d''un message';
COMMENT ON FUNCTION toggle_message_pin IS 'Épingle/désépingle un message';