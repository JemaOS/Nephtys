-- ============================================================================
-- P0 (+P2) — Refermer les policies permissives `messages` + index de perf
-- ============================================================================
-- Problème (constaté via pg_policies) : `messages` avait PLUSIEURS policies
-- SELECT permissives cumulées en OR →
--     fast_read_messages        USING (true)
--     instant_realtime_messages USING (auth.role() = 'authenticated')
--     messages_all_own          ALL USING (sender_id = auth.uid())
-- → tout compte authentifié pouvait lire TOUTES les métadonnées de TOUS les
-- messages. Le durcissement `msg_select_member` était neutralisé.
--
-- On les supprime : il reste les policies membre/propriétaire correctes
-- (msg_select_member / msg_insert_sender_member / messages_update_member /
-- msg_delete_sender). Le Realtime reste autorisé pour les membres (SELECT).
-- ============================================================================

drop policy if exists "fast_read_messages"        on public.messages;
drop policy if exists "instant_realtime_messages" on public.messages;
drop policy if exists "messages_all_own"          on public.messages;

-- Index de performance sur le chargement des messages d'une conversation.
create index if not exists idx_messages_conversation_created
    on public.messages (conversation_id, created_at);

-- Index des clés E2EE par destinataire (déjà créé par 20261010_text_e2ee ;
-- on ré-assert pour être idempotent).
create index if not exists idx_message_text_keys_recipient
    on public.message_text_keys (recipient_id);
