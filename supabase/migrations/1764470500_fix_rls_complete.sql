-- Migration: Fix RLS policies - Version complète et finale
-- Description: Corrige toutes les policies pour permettre la création de conversations
-- Date: 2025-11-30

-- Add missing column
ALTER TABLE public.conversation_members
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- Drop ALL existing policies
DO $$ 
DECLARE
    r RECORD;
BEGIN
    -- Drop conversation_members policies
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversation_members' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversation_members';
    END LOOP;
    
    -- Drop conversations policies
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversations' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversations';
    END LOOP;
END $$;

-- CONVERSATION_MEMBERS: Policies simples sans récursion

CREATE POLICY "conversation_members_select"
ON public.conversation_members
FOR SELECT
TO authenticated
USING (true); -- Permet de voir tous les membres (nécessaire pour créer conversations)

CREATE POLICY "conversation_members_insert"
ON public.conversation_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid() OR
  conversation_id IN (
    SELECT id FROM public.conversations WHERE created_by = auth.uid()
  )
); -- Permet d'ajouter soi-même ou si créateur de la conversation

CREATE POLICY "conversation_members_update"
ON public.conversation_members
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "conversation_members_delete"
ON public.conversation_members
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR role = 'admin');

-- CONVERSATIONS: Policies simples sans sous-requêtes

CREATE POLICY "conversations_select"
ON public.conversations
FOR SELECT
TO authenticated
USING (true); -- Permet de voir toutes les conversations (filtrage côté client)

CREATE POLICY "conversations_insert"
ON public.conversations
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "conversations_update"
ON public.conversations
FOR UPDATE
TO authenticated
USING (true); -- Permet de mettre à jour (filtrage côté client)

CREATE POLICY "conversations_delete"
ON public.conversations
FOR DELETE
TO authenticated
USING (created_by = auth.uid());