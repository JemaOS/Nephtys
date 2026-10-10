-- ============================================================================
-- Phase 1 « cacher le graphe au serveur » (sealed sender) — colonne additive
-- ============================================================================
-- Objectif : le serveur ne doit plus apprendre QUI écrit à qui. On ajoute une
-- colonne opaque `sender_sealed` (un blob scellé par destinataire, cf.
-- src/lib/messaging/sealedSender.ts). Le serveur ne peut pas relier un blob à
-- un utilisateur (clé éphémère par destinataire).
--
-- ADDITIF et NON-CASSANT : colonne nullable, `sender_id` reste peuplé pendant
-- la transition (dual-write). La bascule « serveur aveugle » et le retrait de
-- sender_id viendront dans une phase ultérieure, après validation.
-- ============================================================================

ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS sender_sealed jsonb;

COMMENT ON COLUMN public.messages.sender_sealed IS
    'Sealed sender (phase 1) : tableau de blobs scellés (un par destinataire), opaque pour le serveur.';
