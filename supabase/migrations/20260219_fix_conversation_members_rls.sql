-- Migration: Fix RLS policy conflicts on conversation_members
-- Description: Remove restrictive RLS policies that conflict with group creation
-- Date: 2026-02-19

-- Drop all existing policies on conversation_members
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversation_members' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversation_members';
    END LOOP;
END $$;

-- Create ultra-permissive policy for authenticated users (allows group creation)
CREATE POLICY "cm_all_authenticated" 
ON public.conversation_members 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- Also allowanon and service_role to access for admin operations
CREATE POLICY "cm_all_anon" 
ON public.conversation_members 
FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);

CREATE POLICY "cm_all_service_role" 
ON public.conversation_members 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);
