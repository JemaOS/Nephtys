-- Migration: Create message_reactions table
-- Description: Table pour stocker les réactions emoji aux messages
-- Date: 2025-11-30

-- Create message_reactions table
CREATE TABLE IF NOT EXISTS public.message_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    emoji VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Contrainte: un utilisateur ne peut réagir qu'une seule fois avec le même emoji sur un message
    UNIQUE(message_id, user_id, emoji)
);

-- Create indexes for performance
CREATE INDEX idx_message_reactions_message_id ON public.message_reactions(message_id);
CREATE INDEX idx_message_reactions_user_id ON public.message_reactions(user_id);
CREATE INDEX idx_message_reactions_created_at ON public.message_reactions(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Policy: Users can view reactions on messages they have access to
CREATE POLICY "Users can view reactions on accessible messages"
    ON public.message_reactions
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_reactions.message_id
            AND cm.user_id = auth.uid()
        )
    );

-- Policy: Users can add reactions to messages in their conversations
CREATE POLICY "Users can add reactions to accessible messages"
    ON public.message_reactions
    FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
            SELECT 1 FROM public.messages m
            JOIN public.conversation_members cm ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_id
            AND cm.user_id = auth.uid()
        )
    );

-- Policy: Users can delete their own reactions
CREATE POLICY "Users can delete their own reactions"
    ON public.message_reactions
    FOR DELETE
    USING (user_id = auth.uid());

-- Add comment
COMMENT ON TABLE public.message_reactions IS 'Stores emoji reactions to messages with real-time support';
COMMENT ON COLUMN public.message_reactions.emoji IS 'Unicode emoji character (e.g., 👍, ❤️, 😂)';