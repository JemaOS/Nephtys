-- ============================================================================
-- 2026-10-30 — Correctif d'audit (final) : colonnes de clés privées sur profiles
-- ============================================================================
-- Item #2 : `20261010_drop_profiles_key_columns.sql` s'exécute AVANT
-- `20261010_x25519_profiles.sql` (tri lexicographique : d < x), qui RÉ-AJOUTE
-- `x25519_private_key/_salt/_iv`. Idem `20261010_ratchet_prekeys.sql` (r < x :
-- il s'exécute avant x25519 mais ajoute aussi `ratchet_keys_*`; selon l'ordre
-- exact des fichiers, une ou plusieurs de ces colonnes peuvent survivre au DROP).
-- Résultat possible : des colonnes de matériel de clés privées subsistent sur
-- `public.profiles`, lisible par tout compte authentifié.
--
-- Cette migration (dernier mot, préfixe 20261030) les retire DÉFINITIVEMENT,
-- avec `IF EXISTS` (idempotent, ne casse pas si déjà absentes).
--
-- Le matériel de clés vit désormais côté client (phrase de récupération) ; les
-- tables serveur intermédiaires (`user_key_material`, `user_encrypted_state`)
-- ont déjà été retirées par 20261011_drop_p256_columns_tables.sql.
-- ============================================================================

ALTER TABLE public.profiles
    -- Colonnes explicitement visées par l'audit #2
    DROP COLUMN IF EXISTS x25519_private_key,
    DROP COLUMN IF EXISTS x25519_salt,
    DROP COLUMN IF EXISTS x25519_iv,
    DROP COLUMN IF EXISTS ratchet_keys_encrypted,
    DROP COLUMN IF EXISTS ratchet_keys_salt,
    DROP COLUMN IF EXISTS ratchet_keys_iv,
    DROP COLUMN IF EXISTS encrypted_private_key,
    -- Même famille (legacy) : retirées aussi pour éviter tout résidu lisible.
    DROP COLUMN IF EXISTS private_key_salt,
    DROP COLUMN IF EXISTS private_key_iv,
    DROP COLUMN IF EXISTS password_hash;
