-- ====================================================================
-- Matériel de clés pour X3DH / Double Ratchet (forward secrecy)
-- ====================================================================
-- Ajoute le bundle public + le stockage chiffré des clés privées, en plus
-- des clés P-256 (public_key) et X25519 (x25519_public_key) existantes.
--
--   Public (lisible par les pairs, nécessaire à X3DH) :
--     ratchet_identity_key      (X25519)
--     ratchet_signing_key       (Ed25519, vérifie la signed prekey)
--     ratchet_signed_prekey     (X25519)
--     ratchet_signed_prekey_sig (Ed25519 signature)
--
--   Privé (chiffré par mot de passe, jamais en clair) :
--     ratchet_keys_encrypted / _salt / _iv  (JSON privé : identité, signature,
--     signed prekey, one-time prekeys)
--
-- Les one-time prekeys publiques sont dans une table dédiée pour être
-- consommées (une seule fois) par les initiateurs.
-- ====================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS ratchet_identity_key text,
    ADD COLUMN IF NOT EXISTS ratchet_signing_key text,
    ADD COLUMN IF NOT EXISTS ratchet_signed_prekey text,
    ADD COLUMN IF NOT EXISTS ratchet_signed_prekey_sig text,
    ADD COLUMN IF NOT EXISTS ratchet_keys_encrypted text,
    ADD COLUMN IF NOT EXISTS ratchet_keys_salt text,
    ADD COLUMN IF NOT EXISTS ratchet_keys_iv text,
    ADD COLUMN IF NOT EXISTS ratchet_updated_at timestamptz;

CREATE TABLE IF NOT EXISTS public.one_time_prekeys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    public_key text NOT NULL,
    is_used boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, public_key)
);

CREATE INDEX IF NOT EXISTS idx_one_time_prekeys_available
    ON public.one_time_prekeys (user_id) WHERE is_used = false;

ALTER TABLE public.one_time_prekeys ENABLE ROW LEVEL SECURITY;

-- Un initiateur doit pouvoir lire les prekeys disponibles d'un pair.
DROP POLICY IF EXISTS "otpk_select_available" ON public.one_time_prekeys;
CREATE POLICY "otpk_select_available"
    ON public.one_time_prekeys FOR SELECT
    TO authenticated
    USING (is_used = false OR user_id = auth.uid());

DROP POLICY IF EXISTS "otpk_insert_own" ON public.one_time_prekeys;
CREATE POLICY "otpk_insert_own"
    ON public.one_time_prekeys FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

-- Un initiateur marque la prekey comme consommée au moment de la session.
DROP POLICY IF EXISTS "otpk_update_consume" ON public.one_time_prekeys;
CREATE POLICY "otpk_update_consume"
    ON public.one_time_prekeys FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "otpk_delete_own" ON public.one_time_prekeys;
CREATE POLICY "otpk_delete_own"
    ON public.one_time_prekeys FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());
