-- ============================================================================
-- Fermeture de la fuite ANONYME de public.profiles
-- ============================================================================
-- Contexte : la migration 20261010_revoke_anon_key_exposure a tenté de révoquer
-- les colonnes sensibles au rôle `anon`, mais un privilège de TABLE prime sur
-- un privilège de COLONNE : `anon` détenait encore `SELECT` au niveau table,
-- donc les REVOKE de colonnes n'ont eu aucun effet. Preuve : appel REST anonyme
-- renvoyant encore `encrypted_private_key`.
--
-- Ici on retire le SELECT de table à `anon` : il ne doit lire AUCUNE ligne de
-- profiles (aucune raison, non authentifié).
-- ============================================================================

REVOKE SELECT ON public.profiles FROM anon;

-- Si une fonctionnalité publique a besoin des colonnes strictement publiques,
-- regranter UNIQUEMENT celles-ci (jamais les colonnes de clés privées) :
--   GRANT SELECT (id, username, display_name, avatar_url, bio,
--                 public_key, x25519_public_key, is_online, last_seen)
--     ON public.profiles TO anon;
