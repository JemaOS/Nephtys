-- Migration: Fix messages RLS policies
-- Description: Permet la réception des messages en temps réel
-- Date: 2025-11-30

-- Drop ALL existing policies on messages
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'messages' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.messages';
    END LOOP;
END $$;

-- Create simple policies for messages

-- SELECT: Users can view messages in their conversations
CREATE POLICY "messages_select"
ON public.messages
FOR SELECT
TO authenticated
USING (
  conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_members 
    WHERE user_id = auth.uid()
  )
);

-- INSERT: Users can send messages in their conversations
CREATE POLICY "messages_insert"
ON public.messages
FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_members 
    WHERE user_id = auth.uid()
  )
);

-- UPDATE: Users can update their own messages (for status, editing)
CREATE POLICY "messages_update_own"
ON public.messages
FOR UPDATE
TO authenticated
USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- UPDATE: Users can update message status (delivered/read) for messages they receive
CREATE POLICY "messages_update_status"
ON public.messages
FOR UPDATE
TO authenticated
USING (
  conversation_id IN (
    SELECT conversation_id 
    FROM public.conversation_members 
    WHERE user_id = auth.uid()
  )
);

-- DELETE: Users can delete their own messages
CREATE POLICY "messages_delete"
ON public.messages
FOR DELETE
TO authenticated
USING (sender_id = auth.uid());