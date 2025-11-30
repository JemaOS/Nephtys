-- Migration: Ultra permissive RLS for debugging
-- Description: Policies très permissives pour permettre tout (temporaire pour debug)
-- Date: 2025-11-30

-- Drop ALL policies
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.' || r.tablename;
    END LOOP;
END $$;

-- ULTRA PERMISSIVE POLICIES (pour debug)

-- conversation_members: Tout le monde peut tout faire
CREATE POLICY "cm_all" ON public.conversation_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- conversations: Tout le monde peut tout faire
CREATE POLICY "conv_all" ON public.conversations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- messages: Tout le monde peut tout faire
CREATE POLICY "msg_all" ON public.messages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- contacts: Tout le monde peut tout faire
CREATE POLICY "contacts_all" ON public.contacts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- profiles: Tout le monde peut tout faire
CREATE POLICY "profiles_all" ON public.profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- statuses: Tout le monde peut tout faire
CREATE POLICY "statuses_all" ON public.statuses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- devices: Tout le monde peut tout faire
CREATE POLICY "devices_all" ON public.devices FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- call_logs: Tout le monde peut tout faire
CREATE POLICY "call_logs_all" ON public.call_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- files: Tout le monde peut tout faire
CREATE POLICY "files_all" ON public.files FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- message_reactions: Tout le monde peut tout faire
CREATE POLICY "reactions_all" ON public.message_reactions FOR ALL TO authenticated USING (true) WITH CHECK (true);