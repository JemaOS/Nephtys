-- ============================================================================
-- #5 — Ferme l'auto-adhésion à une conversation arbitraire
-- ============================================================================
-- Ancienne policy `cm_insert_self_or_member` : WITH CHECK
--   (user_id = auth.uid()) OR is_conversation_member(conversation_id)
--   OR (conversation.created_by = auth.uid())
-- La branche `user_id = auth.uid()` permettait à TOUT compte de s'insérer
-- lui-même dans N'IMPORTE QUELLE conversation dont il connaissait l'id, puis
-- de lire ses messages (msg_select_member = is_conversation_member).
--
-- Nouvelle règle : on ne peut insérer un membre que si l'on est DÉJÀ membre de
-- la conversation, ou si l'on en est le créateur. (Créer une conversation +
-- ajouter les membres reste couvert par la branche created_by.)
--
-- Conséquence assumée : `backupService.ensureUserIsMember` (restauration de
-- sauvegardes où created_by != restaurateur) ne pourra plus s'auto-insérer.
-- ============================================================================

DROP POLICY IF EXISTS "cm_insert_self_or_member" ON public.conversation_members;

CREATE POLICY "cm_insert_creator_or_member"
  ON public.conversation_members FOR INSERT
  TO authenticated
  WITH CHECK (
    private.is_conversation_member(conversation_id)
    OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.created_by = auth.uid()
    )
  );
