-- ============================================================================
-- Passphrase recovery pour multi-device E2EE
-- ============================================================================
-- Permet de retrouver la clé privée ECDH sur un nouveau device sans avoir
-- accès au device principal.
--
-- Architecture (style Signal) :
--   1. À la 1ère connexion, l'utilisateur définit une passphrase
--      (recommandation : >= 8 caractères, utilisation locale uniquement)
--   2. La clé privée ECDH est chiffrée avec une clé dérivée de la passphrase
--      via PBKDF2-SHA256 (310 000 itérations, sel aléatoire 16 octets)
--   3. Le résultat (encrypted_private_key + sel + IV) est stocké en DB
--   4. Sur un nouveau device, on demande la passphrase, on dérive la clé,
--      on déchiffre la privée, on l'importe en IndexedDB local.
--
-- L'admin de la DB ne peut PAS déchiffrer la clé privée car il ne connaît
-- pas la passphrase. PBKDF2 310k + AES-GCM = très long à brute-force.
-- ============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT,
    ADD COLUMN IF NOT EXISTS private_key_salt     TEXT,
    ADD COLUMN IF NOT EXISTS private_key_iv       TEXT,
    ADD COLUMN IF NOT EXISTS public_key_updated_at TIMESTAMPTZ;

-- public_key_updated_at sert à détecter quand un user a changé sa paire
-- (les anciens médias deviennent illisibles, les expéditeurs doivent
-- éventuellement re-wrapper avec la nouvelle clé publique).

COMMENT ON COLUMN public.profiles.encrypted_private_key IS
    'Clé privée ECDH chiffrée par AES-GCM avec une clé dérivée de la passphrase utilisateur (PBKDF2). Base64.';
COMMENT ON COLUMN public.profiles.private_key_salt IS
    'Sel PBKDF2 (16 octets, base64). Aléatoire par utilisateur.';
COMMENT ON COLUMN public.profiles.private_key_iv IS
    'IV AES-GCM (12 octets, base64) pour le chiffrement de la clé privée.';
