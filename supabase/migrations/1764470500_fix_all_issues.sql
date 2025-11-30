-- Migration: Fix all RLS and schema issues
-- Description: Corrige les policies récursives et ajoute les colonnes manquantes
-- Date: 2025-11-30

-- Add missing column is_active to conversation_members
ALTER TABLE public.conversation_members
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Drop ALL existing policies on conversation_members to avoid recursion
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversation_members' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversation_members';
    END LOOP;
END $$;

-- Create simple, non-recursive policies for conversation_members

-- SELECT: Users can view their own memberships
CREATE POLICY "conversation_members_select_own"
ON public.conversation_members
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- INSERT: Users can insert their own memberships
CREATE POLICY "conversation_members_insert_own"
ON public.conversation_members
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- UPDATE: Users can update their own memberships
CREATE POLICY "conversation_members_update_own"
ON public.conversation_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE: Users can delete their own memberships
CREATE POLICY "conversation_members_delete_own"
ON public.conversation_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid());

-- Fix conversations policies if needed
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversations' AND schemaname = 'public') LOOP
        IF r.policyname LIKE '%recursive%' OR r.policyname LIKE '%infinite%' THEN
            EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversations';
        END IF;
    END LOOP;
END $$;

-- Drop existing conversation policies first
DROP POLICY IF EXISTS "conversations_select_member" ON public.conversations;
DROP POLICY IF EXISTS "conversations_insert_creator" ON public.conversations;
DROP POLICY IF EXISTS "conversations_update_member" ON public.conversations;
DROP POLICY IF EXISTS "conversations_delete_creator" ON public.conversations;

-- Simple policy for conversations
CREATE POLICY "conversations_select_member"
ON public.conversations
FOR SELECT
TO authenticated
USING (
  id IN (
    SELECT conversation_id
    FROM public.conversation_members
    WHERE user_id = auth.uid()
  )
);

CREATE POLICY "conversations_insert_creator"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "conversations_update_member"
ON public.conversations
FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT conversation_id
    FROM public.conversation_members
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "conversations_delete_creator"
ON public.conversations
FOR DELETE
TO authenticated
USING (created_by = auth.uid());