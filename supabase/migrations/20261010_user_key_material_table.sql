-- ============================================================================
-- Matériel de clés privées déplacé de `profiles` vers une table PROPRIÉTAIRE
-- ============================================================================
-- Problème : `profiles` est lisible par tout compte authentifié (policy
-- USING(true), nécessaire pour la découverte) et contenait les colonnes de
-- clés privées chiffrées. La RLS étant au niveau LIGNE, impossible de cacher
-- une colonne par policy. Le retrait par privilège de colonne est inutilisable
-- ici (casse `select('*')` — cf. doc Supabase « Column Level Security »).
--
-- Solution : table dédiée, accès STRICTEMENT propriétaire (user_id = auth.uid()).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_key_material (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    encrypted_private_key  text,
    private_key_salt       text,
    private_key_iv         text,
    x25519_private_key     text,
    x25519_salt            text,
    x25519_iv              text,
    ratchet_keys_encrypted text,
    ratchet_keys_salt      text,
    ratchet_keys_iv        text,
    updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_key_material ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ukm_owner_all" ON public.user_key_material;
CREATE POLICY "ukm_owner_all"
    ON public.user_key_material FOR ALL
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

REVOKE ALL ON public.user_key_material FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_key_material TO authenticated;

-- Copie du matériel existant depuis profiles (idempotent)
INSERT INTO public.user_key_material (
    user_id,
    encrypted_private_key, private_key_salt, private_key_iv,
    x25519_private_key, x25519_salt, x25519_iv,
    ratchet_keys_encrypted, ratchet_keys_salt, ratchet_keys_iv
)
SELECT
    id,
    encrypted_private_key, private_key_salt, private_key_iv,
    x25519_private_key, x25519_salt, x25519_iv,
    ratchet_keys_encrypted, ratchet_keys_salt, ratchet_keys_iv
FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
