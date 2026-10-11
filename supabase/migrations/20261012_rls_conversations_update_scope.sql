-- ============================================================================
-- 20261012 — conversations UPDATE : créateur/admin uniquement
-- ============================================================================
-- Régression : 20261010_rls_hardening.sql:80-85 a recréé `conv_update_member`
-- (n'importe quel MEMBRE peut modifier la conversation : nom, description,
-- avatar_url, etc.), neutralisant le durcissement admin de
-- 20260513_fix_conversation_update_rls.sql:70-91 (`conv_update_admin_or_creator`).
-- Les policies permissives se cumulant en OR, la plus large gagnait.
--
-- On supprime TOUTES les policies UPDATE/ALL(auth) de `conversations` puis on
-- recrée une policy unique : créateur OU membre admin/owner.
--
-- (Le schéma ne définit que role IN ('admin','member') — see
--  1764462225_create_conversation_members_table.sql:9 — 'owner' est conservé
--  par tolérance.)
-- ============================================================================

-- 1) Retirer toutes les policies d'écriture UPDATE existantes
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'conversations'
          AND (cmd = 'UPDATE' OR (cmd = 'ALL' AND 'authenticated' = ANY (roles)))
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', r.policyname);
    END LOOP;
END
$mig$;

-- 2) Policy unique, resserrée
DROP POLICY IF EXISTS "conv_update_admin_or_creator" ON public.conversations;
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
