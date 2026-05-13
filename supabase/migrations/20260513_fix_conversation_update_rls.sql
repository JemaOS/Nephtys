-- ============================================================================
-- Correctif : permettre aux admins/owners et au créateur de mettre à jour
-- une conversation (avatar_url, description, name, ...).
-- ----------------------------------------------------------------------------
-- Symptôme corrigé :
--   Dans l'app, un admin de groupe change la photo du groupe via la modale
--   « Vue d'ensemble ». L'upload Storage réussit, mais l'UPDATE sur la table
--   `conversations` était silencieusement filtré par une policy RLS trop
--   restrictive (`conv_update` : `created_by = auth.uid()`). Supabase ne
--   renvoie PAS d'erreur dans ce cas — juste 0 ligne modifiée — donc le
--   client croyait que tout s'était bien passé. À la fermeture de la modale,
--   `refreshConversation()` re-fetchait depuis la DB → l'ancien `avatar_url`
--   revenait → l'image disparaissait.
--
-- Stratégie :
--   On garantit qu'un seul jeu de policies cohérent existe sur `conversations`
--   pour les opérations UPDATE / SELECT / INSERT / DELETE, basé sur la
--   membership (admin pour les écritures sensibles).
-- ============================================================================

-- 1) Supprimer TOUTES les policies existantes sur public.conversations
--    pour partir d'un état propre (les migrations précédentes en ont
--    accumulé plusieurs : `conv_all`, `conv_update`, `conv_select`, etc.).
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (
        SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'conversations'
    ) LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', r.policyname);
    END LOOP;
END $$;

-- 2) S'assurer que RLS est bien activée
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

-- 3) service_role : accès complet (pour les edge functions / admin)
CREATE POLICY "conv_all_service_role"
    ON public.conversations
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 4) SELECT : tous les membres de la conversation peuvent la lire
CREATE POLICY "conv_select_member"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (
        public.is_conversation_member(id)
        OR created_by = auth.uid()
    );

-- 5) INSERT : tout authentifié peut créer une conversation où il est créateur
CREATE POLICY "conv_insert_self"
    ON public.conversations
    FOR INSERT
    TO authenticated
    WITH CHECK (
        created_by = auth.uid()
        OR created_by IS NULL
    );

-- 6) UPDATE : créateur OU admin/owner du groupe peut mettre à jour
--    (avatar_url, description, name, archived_at, muted_until, …)
--    NOTE : on n'utilise PAS is_conversation_member pour le check admin
--    afin d'éviter une confusion ; on lit directement conversation_members.
CREATE POLICY "conv_update_admin_or_creator"
    ON public.conversations
    FOR UPDATE
    TO authenticated
    USING (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = conversations.id
              AND cm.user_id = auth.uid()
              AND cm.role IN ('admin', 'owner')
        )
    )
    WITH CHECK (
        created_by = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = conversations.id
              AND cm.user_id = auth.uid()
              AND cm.role IN ('admin', 'owner')
        )
    );

-- 7) DELETE : seul le créateur peut supprimer la conversation
CREATE POLICY "conv_delete_creator"
    ON public.conversations
    FOR DELETE
    TO authenticated
    USING (created_by = auth.uid());
