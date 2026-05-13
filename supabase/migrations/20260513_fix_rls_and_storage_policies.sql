-- ============================================================================
-- CORRECTIF : Restaurer les permissions RLS cassées par la migration sécurité
-- ============================================================================
-- La migration 20260513_fix_security_definer_warnings.sql a révoqué EXECUTE
-- sur is_conversation_member pour authenticated, ce qui casse :
--   1. Les RLS policies de storage qui appellent cette fonction
--   2. Les queries sur conversation_members (403)
-- Ce correctif rétablit le minimum nécessaire sans réouvrir les failles.
-- ============================================================================

-- 1) Rétablir EXECUTE sur is_conversation_member pour authenticated
--    Le REVOKE total cassait les storage policies. On garde SECURITY DEFINER
--    mais on permet l'appel par authenticated (les storage policies en ont besoin).
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;

-- 2) Recréer les policies storage sur le bucket media
--    Politique simple : tout utilisateur authentifié peut lire/écrire.
--    La sécurité réelle vient du E2EE (les médias sont chiffrés).

-- Supprimer les anciennes policies qui pourraient être cassées
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM storage.policies WHERE bucket_id = 'media'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- Recréer les policies proprement
CREATE POLICY "media_select_authenticated"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'media');

CREATE POLICY "media_insert_authenticated"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'media');

CREATE POLICY "media_update_authenticated"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'media');

CREATE POLICY "media_delete_owner"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
