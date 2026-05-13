-- ====================================================================
-- Hotfix : restaurer une policy SELECT sur storage.objects pour le bucket
-- `media`, supprimée par erreur dans 20260513_security_hardening.sql.
-- ====================================================================
-- Contexte :
--   La migration de durcissement avait supprimé la policy "Public media
--   access" (FOR SELECT TO authenticated USING (bucket_id = 'media')) en
--   réponse au warning « public_bucket_allows_listing ».
--
--   Conséquence : impossible pour le client de faire `upsert: true`
--   (avatars, photos de groupe), car Supabase fait un SELECT préalable
--   pour décider INSERT vs UPDATE → erreur RLS.
--
-- Solution : recréer une policy SELECT plus étroite, qui :
--   • Autorise les authenticated à voir les objets dans les dossiers
--     « publics » fonctionnels de l'app (avatars, groups), nécessaires
--     pour upsert et navigation.
--   • Autorise chaque user à voir ses propres objets (path commençant
--     par auth.uid() ou restored/auth.uid()).
--
--   Le linter warning « public_bucket_allows_listing » peut subsister
--   sur les dossiers avatars/groups, mais c'est intentionnel : ce sont
--   des avatars publics et la donnée n'est pas sensible.
-- ====================================================================

-- Nettoyer toute version résiduelle
DROP POLICY IF EXISTS "Public media access" ON storage.objects;
DROP POLICY IF EXISTS "Users can read media" ON storage.objects;

-- Policy SELECT scoped : avatars + groups + propre dossier + restored/<uid>
CREATE POLICY "Users can read media"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'media'
        AND (
            (storage.foldername(name))[1] = 'avatars'
            OR (storage.foldername(name))[1] = 'groups'
            OR (storage.foldername(name))[1] = auth.uid()::text
            OR (
                (storage.foldername(name))[1] = 'restored'
                AND (storage.foldername(name))[2] = auth.uid()::text
            )
        )
    );

-- Note : les URLs publiques (getPublicUrl) continueront de fonctionner
-- pour TOUS les visiteurs car le bucket est marqué public — les policies
-- RLS ne s'appliquent qu'aux requêtes via l'API SDK (storage.from().*).
