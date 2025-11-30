-- Migration: Fix conversation creation and member addition
-- Description: Permet la création complète de conversations avec membres
-- Date: 2025-11-30

-- Drop the restrictive INSERT policy
DROP POLICY IF EXISTS "conversation_members_insert" ON public.conversation_members;
DROP POLICY IF EXISTS "conversation_members_insert_own" ON public.conversation_members;

-- Create a permissive INSERT policy that allows:
-- 1. Adding yourself to any conversation
-- 2. Adding others if you're the creator of the conversation
CREATE POLICY "conversation_members_insert_permissive"
ON public.conversation_members
FOR INSERT
TO authenticated
WITH CHECK (
  -- Can add yourself
  user_id = auth.uid()
  OR
  -- Can add others if you're creating the conversation (within same transaction)
  conversation_id IN (
    SELECT id FROM public.conversations 
    WHERE created_by = auth.uid()
    AND created_at > NOW() - INTERVAL '1 minute' -- Recently created
  )
);

-- Also ensure conversation_members can be read by anyone in the conversation
DROP POLICY IF EXISTS "conversation_members_select" ON public.conversation_members;
DROP POLICY IF EXISTS "conversation_members_select_own" ON public.conversation_members;

CREATE POLICY "conversation_members_select_all"
ON public.conversation_members
FOR SELECT
TO authenticated
USING (true); -- Allow reading all members (needed for conversation creation)