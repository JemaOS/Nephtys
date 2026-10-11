-- ============================================================================
-- 20261012 — Storage : décision de périmètre (documentée) + can_access_media
-- ============================================================================
-- ════════════════════════════════════════════════════════════════════════════
-- PARTIE A — storage.objects : AUCUN CHANGEMENT (garde-fou « ne rien casser »)
-- ════════════════════════════════════════════════════════════════════════════
-- Condition requise par l'audit : ne scoper INSERT/UPDATE/DELETE au préfixe
-- uid QUE SI TOUS les chemins d'upload de l'app commencent par l'uid.
--
-- PREUVE (grep) : ce n'est PAS le cas. Conventions réelles du bucket `media` :
--
--   • avatars/<userId>/avatar-<ts>.<ext>        (photo de profil)
--       → src/pages/SettingsPage.tsx:528        `avatars/${user.id}/...`
--   • avatars/<conversationId>/avatar-<ts>.<ext> (avatar de conversation DIRECTE)
--       → src/components/ConversationInfo.tsx:420-421 `avatars/${conversationId}/...`
--   • groups/<convId>/avatar.<ext>              (photo de groupe)
--       → src/GroupsPage.tsx:127,154 ; src/components/GroupManagement.tsx:192
--       → src/components/ConversationInfo.tsx:420  `groups/${conversationId}/...`
--   • groups/new-<ts>/avatar.<ext>              (avatar groupe temporaire)
--       → src/pages/GroupsPage.tsx:127
--   • restored/<userId>/...                     (médias restaurés d'une sauvegarde)
--       → src/lib/backupService.ts:547 `restored/${userId}/...`
--   • <userId>/<folder>/<ts>_<name>             (médias E2EE de conversation)
--       → src/components/MediaUploader.tsx:459,752,848
--       → src/components/DocumentPreview/DocumentThumbnail.tsx:114
--       → src/pages/ChatViewPage.tsx:2399 (vocal `<userId>/<ts>.ext`)
--
-- Les préfixes `avatars/`, `groups/`, `restored/` NE commencent PAS par l'uid :
-- un scope `(storage.foldername(name))[1] = auth.uid()::text` casserait les
-- avatars (profil, conversation, groupe) et la restauration de sauvegarde.
-- → on laisse INSERT/UPDATE/DELETE inchangés et on RAPPORTE (voir rapport).
--
-- ── anon_files : AUCUN CHANGEMENT ──────────────────────────────────────────
-- Chemins NON owner-préfixés : préfixe ALÉATOIRE (capacité, type XFTP).
--   → src/lib/relay/fileTransfer.ts:97,104,128 `\`${randomPrefix}/${i}\``
-- Le scope owner est donc impossible → laissé inchangé (rapporté).
--
-- ── media SELECT : AUCUN CHANGEMENT ────────────────────────────────────────
-- Le chemin des médias de conversation est `<uploaderUserId>/<folder>/...` : il
-- NE contient PAS l'id de conversation, donc un média ne peut PAS être rattaché
-- à une conversation donnée depuis son path. Le seul rattachement possible est
-- « partage une conversation avec l'uploadeur » (logique `can_access_media`),
-- qui a DÉJÀ cassé l'affichage par le passé :
--   • 20260513_private_media_storage.sql (media_select_by_membership)
--   • 20260513_simplify_media_select.sql:2-6 le documente explicitement
--     (« auth.uid() pas toujours présent selon le flow ») et élargit le SELECT.
-- Conformément à la consigne, on NE MODIFIE PAS le SELECT bucket-wide : il
-- s'agit d'une fuite de MÉTADONNÉES uniquement (le contenu est chiffré E2EE).
-- Par ailleurs, les policies INSERT/UPDATE/DELETE réellement rétablies sur la
-- base (media_*_authenticated, 20260513_fix_unread_and_storage.sql:59-86) ont
-- été laissées telles quelles pour la même raison (préfixes hétérogènes).
--
-- ════════════════════════════════════════════════════════════════════════════
-- PARTIE B — can_access_media : SECURITY INVOKER + révocation EXECUTE
-- ════════════════════════════════════════════════════════════════════════════
-- La dernière définition en date (20260513_private_media_storage.sql:43-111,
-- exécutée APRÈS 20260513_fix_security_definer_warnings.sql) l'a recréée en
-- SECURITY DEFINER avec GRANT EXECUTE à authenticated. Aucune policy active ne
-- l'utilise plus (media_select_by_membership a été supprimée par
-- 20260513_simplify_media_select.sql). On la remet en SECURITY INVOKER (elle
-- n'utilise que auth.uid()) et on révoque EXECUTE à anon/authenticated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.can_access_media(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
    v_uid       uuid := auth.uid();
    v_parts     text[];
    v_folder    text;
    v_subfolder text;
BEGIN
    IF v_uid IS NULL THEN
        RETURN false;
    END IF;

    v_parts := string_to_array(p_path, '/');
    IF array_length(v_parts, 1) < 2 THEN
        RETURN false;
    END IF;

    v_folder    := v_parts[1];
    v_subfolder := v_parts[2];

    -- avatars/<userId>/... → lecture pour tous les authentifiés
    IF v_folder = 'avatars' THEN
        RETURN true;
    END IF;

    -- groups/<convId>/... → réservé aux membres de la conversation
    IF v_folder = 'groups' THEN
        RETURN EXISTS (
            SELECT 1
            FROM public.conversation_members cm
            WHERE cm.conversation_id::text = v_subfolder
              AND cm.user_id = v_uid
        );
    END IF;

    -- <userId>/... → le propriétaire et les membres de ses conversations
    IF v_subfolder = v_uid::text THEN
        RETURN true;
    END IF;

    -- Autres chemins → refus par défaut
    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_media(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.can_access_media(text) IS
    'Helper de chemin Storage. SECURITY INVOKER : n''utilise que auth.uid(). Interviewé par aucune policy active ; EXECUTE révoqué à anon/authenticated.';
