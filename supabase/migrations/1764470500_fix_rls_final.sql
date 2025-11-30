-- Migration: Fix RLS policies - Version finale simplifiée
-- Description: Corrige toutes les policies récursives
-- Date: 2025-11-30

-- Add missing column
ALTER TABLE public.conversation_members
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Drop ALL policies on conversation_members
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversation_members' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversation_members';
    END LOOP;
END $$;

-- Drop ALL policies on conversations
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversations' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversations';
    END LOOP;
END $$;

-- Create SIMPLE policies for conversation_members (no recursion)
CREATE POLICY "cm_select" ON public.conversation_members FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cm_insert" ON public.conversation_members FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "cm_update" ON public.conversation_members FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "cm_delete" ON public.conversation_members FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Create SIMPLE policies for conversations (no subqueries)
CREATE POLICY "conv_select" ON public.conversations FOR SELECT TO authenticated USING (true);
CREATE POLICY "conv_insert" ON public.conversations FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "conv_update" ON public.conversations FOR UPDATE TO authenticated USING (created_by = auth.uid());
CREATE POLICY "conv_delete" ON public.conversations FOR DELETE TO authenticated USING (created_by = auth.uid());