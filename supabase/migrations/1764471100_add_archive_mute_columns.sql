-- Migration: Add archive and mute columns to conversation_members
-- Description: Ajoute les colonnes is_archived et is_muted pour gérer l'archivage et le mute
-- Date: 2025-11-30

-- Add columns directly using IF NOT EXISTS
ALTER TABLE public.conversation_members 
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false;

ALTER TABLE public.conversation_members 
ADD COLUMN IF NOT EXISTS is_muted BOOLEAN DEFAULT false;

ALTER TABLE public.conversation_members 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_conversation_members_archived 
ON public.conversation_members(user_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_conversation_members_muted 
ON public.conversation_members(user_id, is_muted);

CREATE INDEX IF NOT EXISTS idx_conversation_members_pinned 
ON public.conversation_members(user_id, is_pinned);
