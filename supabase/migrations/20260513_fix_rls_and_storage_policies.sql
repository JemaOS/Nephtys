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
--
--    CORRECTIF (2026-10-36, item #5 sec24) : la fonction `public.is_conversation_member`
--    n'existe qu'à partir de `20260513_security_hardening.sql`, qui s'exécute APRÈS
--    ce fichier (ordre lexicographique). Le GRANT inconditionnel échouait donc sur
--    un rejeu à froid (« function does not exist »). On le rend idempotent.
DO $mig$
BEGIN
  IF to_regprocedure('public.is_conversation_member(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated';
  END IF;
END
$mig$;

-- 2) Recréer les policies storage sur le bucket media
--    Politique simple : tout utilisateur authentifié peut lire/écrire.
--    La sécurité réelle vient du E2EE (les médias sont chiffrés).

-- Supprimer les anciennes policies qui pourraient être cassées
-- CORRECTIF (2026-10-36, item #5 sec24) : `storage.policies` N'EXISTE PAS
-- (les policies vivent dans `pg_policies`). L'ancienne référence levait
-- « relation does not exist ». On lit désormais pg_policies, en ciblant les
-- policies du bucket `media` (nom `media*` ou prédicat mentionnant 'media').
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename  = 'objects'
      AND (
            policyname LIKE 'media%'
         OR coalesce(qual, '')       ILIKE '%''media''%'
         OR coalesce(with_check, '') ILIKE '%''media''%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- Recréer les policies proprement (état transitoire ; l'état FINAL scopé est
-- établi par 20261027/20261028 puis re-joué par
-- 20261036_fix_media_storage_policy_recreate.sql).
DROP POLICY IF EXISTS "media_select_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_insert_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_update_authenticated" ON storage.objects;
DROP POLICY IF EXISTS "media_delete_owner"         ON storage.objects;

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
