-- Migration: update_auth_pseudo_only
-- Created at: 1764463341

-- Modifier la table profiles pour authentification par pseudo uniquement
-- Ajouter colonne password_hash pour stockage sécurisé
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Créer une fonction pour authentification par pseudo
CREATE OR REPLACE FUNCTION authenticate_user(p_username TEXT, p_password TEXT)
RETURNS TABLE(user_id UUID, success BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT id, (password_hash = crypt(p_password, password_hash)) as success
  FROM profiles
  WHERE username = p_username;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Index sur username pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_profiles_username_lower ON profiles(LOWER(username));;