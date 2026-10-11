-- ============================================================================
-- Retrait de la pile P-256 (modele « phrase de recuperation » / X25519)
-- ============================================================================
-- Aucune cle P-256 n'existe plus cote client : les cles sont derivees de la
-- phrase (X25519 + X3DH/ratchet + ML-KEM). On retire donc :
--   • les colonnes P-256 de public.profiles ;
--   • les tables de blocs chiffres serveur devenues inutiles.
-- ============================================================================

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS public_key,
    DROP COLUMN IF EXISTS public_key_updated_at;

DROP TABLE IF EXISTS public.user_key_material;
DROP TABLE IF EXISTS public.user_encrypted_state;
