-- ====================================================================
-- E2EE du texte : clés de message
-- ====================================================================
-- Architecture (cf. src/lib/textEncryption.ts) :
--   messages.content              : ciphertext AES-256-GCM (base64)
--   messages.encryption_metadata  : { "v": 1, "iv": "<base64>" }
--   message_text_keys             : pour chaque (message, recipient), la
--                                   clé AES du message chiffrée avec la clé
--                                   partagée sender↔recipient (ECDH-derived).
--
-- L'admin de la base ne peut JAMAIS lire le contenu d'un message texte :
--   • le ciphertext est stocké tel quel dans messages.content
--   • la clé AES est chiffrée pour chaque destinataire avec un secret que
--     l'admin ne possède pas (la clé privée ECDH du destinataire, stockée
--     uniquement sur ses appareils).
--
-- Miroir exact de la table `message_media_keys` créée par
-- 20260513_e2ee_media_keys.sql.
-- ====================================================================

-- 1) Marquage des messages texte chiffrés
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_text_encrypted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.messages.is_text_encrypted IS
    'true si messages.content est un ciphertext E2EE. La clé AES est dans message_text_keys.';

-- 2) Table message_text_keys
CREATE TABLE IF NOT EXISTS public.message_text_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Clé AES du message, chiffrée avec la clé partagée sender↔recipient
    encrypted_key text NOT NULL,
    -- IV utilisé pour le chiffrement de la clé (AES-GCM 12 bytes)
    iv text NOT NULL,
    -- Clé publique du sender (pour dériver la clé partagée côté recipient)
    sender_public_key text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),

    UNIQUE (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_message_text_keys_message
    ON public.message_text_keys (message_id);

CREATE INDEX IF NOT EXISTS idx_message_text_keys_recipient
    ON public.message_text_keys (recipient_id);

-- 3) RLS : un user ne peut lire QUE les clés qui lui sont destinées
ALTER TABLE public.message_text_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mtk_select_recipient" ON public.message_text_keys;
DROP POLICY IF EXISTS "mtk_insert_sender" ON public.message_text_keys;
DROP POLICY IF EXISTS "mtk_delete_sender" ON public.message_text_keys;

CREATE POLICY "mtk_select_recipient"
    ON public.message_text_keys
    FOR SELECT
    TO authenticated
    USING (recipient_id = auth.uid());

CREATE POLICY "mtk_insert_sender"
    ON public.message_text_keys
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND m.sender_id = auth.uid()
        )
    );

CREATE POLICY "mtk_delete_sender"
    ON public.message_text_keys
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND m.sender_id = auth.uid()
        )
    );
