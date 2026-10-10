-- ============================================================================
-- Phase 1c — serveur aveugle à l'expéditeur
-- ============================================================================
-- Objectif : le serveur ne stocke plus QUI écrit à qui. L'identité de
-- l'expéditeur est portée par `sender_sealed` (blobs scellés authentifiés,
-- vérifiés côté client). On autorise donc l'insertion sans `sender_id`.
--
-- Risque assumé (directive produit) : les agrégats/filtres SERVEUR par
-- sender_id (compteurs non-lus, purge « mes messages ») se dégradent tant
-- qu'ils ne sont pas recalculés côté client.
-- ============================================================================

ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;

DROP POLICY IF EXISTS "msg_insert_sender_member" ON public.messages;
CREATE POLICY "msg_insert_sender_member"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (sender_id IS NULL OR sender_id = auth.uid())
    AND private.is_conversation_member(conversation_id)
  );
