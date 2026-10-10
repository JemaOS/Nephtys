-- ============================================================================
-- Retrait du matériel de clés privées de public.profiles
-- ============================================================================
-- Prérequis : 20261010_user_key_material_table.sql appliqué ET copie vérifiée
-- (matériel identique dans user_key_material). Le client lit/écrit désormais
-- user_key_material via src/lib/keyMaterial.ts.
--
-- On retire les colonnes de profiles car elles sont lisibles par tout compte
-- authentifié (policy SELECT USING(true)). `select('*')` sur profiles continue
-- de fonctionner (colonnes supprimées, pas de privilège révoqué).
-- ============================================================================

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS encrypted_private_key,
    DROP COLUMN IF EXISTS private_key_salt,
    DROP COLUMN IF EXISTS private_key_iv,
    DROP COLUMN IF EXISTS x25519_private_key,
    DROP COLUMN IF EXISTS x25519_salt,
    DROP COLUMN IF EXISTS x25519_iv,
    DROP COLUMN IF EXISTS ratchet_keys_encrypted,
    DROP COLUMN IF EXISTS ratchet_keys_salt,
    DROP COLUMN IF EXISTS ratchet_keys_iv,
    -- legacy : 0/8 peuplé, 0 usage client
    DROP COLUMN IF EXISTS password_hash;
