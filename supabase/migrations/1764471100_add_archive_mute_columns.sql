-- Migration: Add archive and mute columns to conversation_members
-- Description: Ajoute les colonnes is_archived et is_muted pour gérer l'archivage et le mute
-- Date: 2025-11-30

-- Table name constant to avoid duplication
DO $
DECLARE
  tbl_name TEXT := 'conversation_members';
BEGIN
  -- Ajouter la colonne is_archived si elle n'existe pas
  EXECUTE format(
    'DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = %L AND column_name = %L) THEN ALTER TABLE public.%I ADD COLUMN is_archived BOOLEAN DEFAULT false; END IF; END $',
    tbl_name, 'is_archived', tbl_name
  );

  -- Ajouter la colonne is_muted si elle n'existe pas
  EXECUTE format(
    'DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = %L AND column_name = %L) THEN ALTER TABLE public.%I ADD COLUMN is_muted BOOLEAN DEFAULT false; END IF; END $',
    tbl_name, 'is_muted', tbl_name
  );

  -- Ajouter la colonne is_pinned si elle n'existe pas
  EXECUTE format(
    'DO $ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = %L AND column_name = %L) THEN ALTER TABLE public.%I ADD COLUMN is_pinned BOOLEAN DEFAULT false; END IF; END $',
    tbl_name, 'is_pinned', tbl_name
  );
END $;

-- Créer un index pour améliorer les performances
CREATE INDEX IF NOT EXISTS idx_conversation_members_archived 
ON public.conversation_members(user_id, is_archived);

CREATE INDEX IF NOT EXISTS idx_conversation_members_muted 
ON public.conversation_members(user_id, is_muted);

CREATE INDEX IF NOT EXISTS idx_conversation_members_pinned 
ON public.conversation_members(user_id, is_pinned);
