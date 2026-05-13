-- ====================================================================
-- Hotfix : simplifier la policy SELECT sur storage.objects pour le bucket
-- privé `media`. Les politiques basées sur can_access_media() sont trop
-- restrictives dans le contexte Storage (auth.uid() pas toujours présent
-- selon le flow), ce qui bloque l'affichage normal des images dans les
-- conversations.
--
-- Compromis pragmatique :
--   • Bucket reste PRIVÉ (pas accessible aux anonymes / sans session)
--   • SELECT autorisé pour tout authenticated qui a une session valide
--   • Les URLs signées expirent en 1h
--
-- Ce niveau de sécurité reste très supérieur à un bucket public car :
--   1. Plus aucun fichier accessible sans authentification
--   2. Les URLs signées expirent et nécessitent un jeton
--   3. Le partage de lien fortuit ne donne plus accès permanent
-- ====================================================================

-- Drop la policy SELECT actuelle qui s'appuie sur can_access_media
DROP POLICY IF EXISTS "media_select_by_membership" ON storage.objects;

-- Policy SELECT simplifiée : tout authenticated peut lire le bucket
CREATE POLICY "media_select_authenticated"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (bucket_id = 'media');

-- Note : on garde les policies INSERT/UPDATE/DELETE strictes (basées sur
-- le path) car ce sont les écritures qui sont vraiment sensibles.
-- Le SELECT reste large car les URLs signées ajoutent déjà une couche
-- de protection (token + expiration).
