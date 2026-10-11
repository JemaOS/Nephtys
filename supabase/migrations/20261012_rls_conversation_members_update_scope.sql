-- ============================================================================
-- 20261012 — conversation_members UPDATE : soi-même OU admin/créateur
-- ============================================================================
-- Régression : 20261010_rls_hardening.sql:115-120 a recréé `cm_update_self`
-- avec `USING (user_id = auth.uid() OR private.is_conversation_member(...))`
-- → n'importe quel MEMBRE pouvait modifier la ligne d'un AUTRE membre
-- (is_muted, is_archived, is_pinned, role...). Le trigger
-- `private.prevent_member_role_escalation` ne bloque que le rôle, pas le reste.
--
-- On supprime toutes les policies UPDATE/ALL(auth) de `conversation_members`
-- et on recrée une policy resserrée.
--
-- ⚠️ ÉCART VOLONTAIRE au « user_id = auth.uid() » strict (vérifié dans le code) :
--   le client promeut un AUTRE membre en admin depuis la gestion de groupe :
--     src/components/GroupManagement.tsx:105-109
--       .from('conversation_members').update({ role: 'admin' })
--         .eq('conversation_id', conversationId).eq('user_id', userId)  // userId ≠ self
--   Un `user_id = auth.uid()` strict casserait cette fonctionnalité. On autorise
--   donc, en plus de sa propre ligne, les mises à jour par le créateur ou un
--   admin/owner de la conversation. L'escalade de rôle reste bloquée par le
--   trigger `trg_prevent_member_role_escalation` pour les non-admins.
--
-- Mises à jour « self » légitimes préservées (mute/archive/pin/last_read) :
--   conversationService.ts:14, ArchivedPage.tsx:140, ConversationActions.tsx:78,
--   ConversationInfo.tsx:522, ChatsPage.tsx:586,614,634,928, ChatViewPageComponents.tsx:527,542
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
          AND tablename  = 'conversation_members'
          AND (cmd = 'UPDATE' OR (cmd = 'ALL' AND 'authenticated' = ANY (roles)))
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_members', r.policyname);
    END LOOP;
END
$mig$;

-- 2) Policy unique, resserrée
DROP POLICY IF EXISTS "cm_update_self_or_admin" ON public.conversation_members;
CREATE POLICY "cm_update_self_or_admin"
    ON public.conversation_members
    FOR UPDATE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_members.conversation_id
              AND c.created_by = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = conversation_members.conversation_id
              AND cm.user_id = auth.uid()
              AND cm.role IN ('admin', 'owner')
        )
    )
    WITH CHECK (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_members.conversation_id
              AND c.created_by = auth.uid()
        )
        OR EXISTS (
            SELECT 1 FROM public.conversation_members cm
            WHERE cm.conversation_id = conversation_members.conversation_id
              AND cm.user_id = auth.uid()
              AND cm.role IN ('admin', 'owner')
        )
    );
