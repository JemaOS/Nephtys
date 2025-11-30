-- Migration: Fix RLS policies infinite recursion
-- Description: Corrige les policies récursives sur conversation_members
-- Date: 2025-11-30

-- Drop existing problematic policies on conversation_members
DROP POLICY IF EXISTS "Users can view their own memberships" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can view memberships in their conversations" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can insert memberships" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can update their own memberships" ON public.conversation_members;
DROP POLICY IF EXISTS "Users can delete their own memberships" ON public.conversation_members;

-- Create simple, non-recursive policies

-- Policy: Users can view their own memberships
CREATE POLICY "Users can view their own memberships"
ON public.conversation_members
FOR SELECT
USING (user_id = auth.uid());

-- Policy: Users can insert memberships (for creating conversations)
CREATE POLICY "Users can insert memberships"
ON public.conversation_members
FOR INSERT
WITH CHECK (user_id = auth.uid());

-- Policy: Admins can insert other members
CREATE POLICY "Admins can add members"
ON public.conversation_members
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = conversation_members.conversation_id
    AND cm.user_id = auth.uid()
    AND cm.role = 'admin'
  )
);

-- Policy: Users can update their own memberships
CREATE POLICY "Users can update their own memberships"
ON public.conversation_members
FOR UPDATE
USING (user_id = auth.uid());

-- Policy: Users can delete their own memberships (leave conversation)
CREATE POLICY "Users can delete their own memberships"
ON public.conversation_members
FOR DELETE
USING (user_id = auth.uid());

-- Policy: Admins can delete other members
CREATE POLICY "Admins can remove members"
ON public.conversation_members
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.conversation_members cm
    WHERE cm.conversation_id = conversation_members.conversation_id
    AND cm.user_id = auth.uid()
    AND cm.role = 'admin'
  )
);