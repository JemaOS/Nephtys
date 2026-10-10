-- ====================================================================
-- Clés X25519 par utilisateur (migration P-256 → X25519, coexistence)
-- ====================================================================
-- Ajoute une paire X25519 dédiée par profil, en parallèle de la paire
-- P-256 historique (profiles.public_key), sans invalider l'existant :
--   • x25519_public_key : clé publique taguée `x25519:<base64>` (publique)
--   • x25519_private_key / _salt / _iv : clé privée chiffrée par mot de
--     passe (PBKDF2-SHA256 310k + AES-GCM 256), jamais en clair.
--
-- Le chiffrement du texte (src/lib/textEncryption.ts) utilise X25519 quand
-- l'émetteur ET le destinataire disposent d'une clé X25519, et retombe
-- sinon sur la pile P-256 — d'où la coexistence sans régression.
--
-- La clé privée chiffrée reste protégée même si un tiers peut lire la ligne
-- (le blob est illisible sans le mot de passe). Le durcissement RLS de
-- `profiles` (interdiction de l'énumération anonyme) est traité dans
-- 20261010_profiles_rls_hardening.sql.
-- ====================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS x25519_public_key text,
    ADD COLUMN IF NOT EXISTS x25519_private_key text,
    ADD COLUMN IF NOT EXISTS x25519_salt text,
    ADD COLUMN IF NOT EXISTS x25519_iv text,
    ADD COLUMN IF NOT EXISTS x25519_public_key_updated_at timestamptz;

COMMENT ON COLUMN public.profiles.x25519_public_key IS
    'Clé publique X25519 taguée ''x25519:<base64>''. Coexiste avec la clé P-256 public_key.';
COMMENT ON COLUMN public.profiles.x25519_private_key IS
    'Clé privée X25519 chiffrée par mot de passe (PBKDF2 310k + AES-GCM 256). Jamais en clair.';
