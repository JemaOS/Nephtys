-- ====================================================================
-- E2EE des médias : tables de clés
-- ====================================================================
-- Architecture :
--   profiles.public_key       : clé publique ECDH (P-256) du user, base64
--   message_media_keys        : pour chaque (message, recipient), la clé
--                               AES du média chiffrée avec la clé partagée
--                               sender↔recipient (ECDH-derived).
--
-- L'admin de la base ne peut JAMAIS lire le contenu d'un média :
--   • Le binaire est chiffré dans le bucket (octets aléatoires)
--   • La clé AES est chiffrée pour chaque destinataire avec un secret
--     que l'admin ne possède pas (clé privée du destinataire)
-- ====================================================================

-- 1) Ajouter la colonne public_key à profiles si elle n'existe pas
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS public_key text;

CREATE INDEX IF NOT EXISTS idx_profiles_public_key
    ON public.profiles (id) WHERE public_key IS NOT NULL;

-- 2) Table message_media_keys
CREATE TABLE IF NOT EXISTS public.message_media_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Clé AES du média, chiffrée avec la clé partagée sender↔recipient
    encrypted_key text NOT NULL,
    -- IV utilisé pour le chiffrement de la clé (AES-GCM 12 bytes)
    iv text NOT NULL,
    -- Clé publique du sender (pour que le recipient puisse dériver la clé partagée)
    sender_public_key text NOT NULL,
    -- IV utilisé pour le chiffrement du média lui-même
    media_iv text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT NOW(),

    UNIQUE (message_id, recipient_id)
);

CREATE INDEX IF NOT EXISTS idx_message_media_keys_message
    ON public.message_media_keys (message_id);

CREATE INDEX IF NOT EXISTS idx_message_media_keys_recipient
    ON public.message_media_keys (recipient_id);

-- 3) RLS : un user ne peut lire QUE les clés qui lui sont destinées
ALTER TABLE public.message_media_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mmk_select_recipient" ON public.message_media_keys;
DROP POLICY IF EXISTS "mmk_insert_sender" ON public.message_media_keys;
DROP POLICY IF EXISTS "mmk_delete_sender" ON public.message_media_keys;

CREATE POLICY "mmk_select_recipient"
    ON public.message_media_keys
    FOR SELECT
    TO authenticated
    USING (recipient_id = auth.uid());

CREATE POLICY "mmk_insert_sender"
    ON public.message_media_keys
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND m.sender_id = auth.uid()
        )
    );

CREATE POLICY "mmk_delete_sender"
    ON public.message_media_keys
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.messages m
            WHERE m.id = message_id
              AND m.sender_id = auth.uid()
        )
    );

-- 4) Marquage des messages chiffrés
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS is_media_encrypted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.messages.is_media_encrypted IS
    'true si media_url pointe vers un fichier chiffré E2EE. La clé AES est dans message_media_keys.';
