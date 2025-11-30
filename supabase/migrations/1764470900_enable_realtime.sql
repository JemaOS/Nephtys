-- Migration: Enable Realtime on all tables
-- Description: Active Realtime pour toutes les tables nécessaires
-- Date: 2025-11-30

-- Enable Realtime on messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Enable Realtime on conversations table
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;

-- Enable Realtime on conversation_members table
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_members;

-- Enable Realtime on message_reactions table
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;

-- Enable Realtime on contacts table
ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;

-- Enable Realtime on statuses table
ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;

-- Verify Realtime is enabled
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';