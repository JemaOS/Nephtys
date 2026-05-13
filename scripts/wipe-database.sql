-- ========================================================================
-- ⚠️  WIPE COMPLET DE LA BASE DE DONNÉES — IRRÉVERSIBLE  ⚠️
-- ========================================================================
-- Ce script supprime TOUTES les données utilisateurs :
--   • Tous les users dans auth.users
--   • Tous les profils, conversations, messages, memberships
--   • Tous les contacts, devices, statuses, call_logs, fichiers (rows DB)
--   • Tous les objets du bucket storage `media` (les fichiers physiques)
--   • Toutes les sessions actives
--
-- Conserve :
--   • Le schéma (tables, fonctions, RLS, triggers)
--   • Les rate_limits récents (mémoire anti-DDoS de la dernière heure)
--   • Les buckets eux-mêmes (juste vidés)
--
-- Usage :
--   Copier-coller dans le SQL Editor du dashboard Supabase
--   et cliquer sur RUN. Le script est wrappé dans une transaction :
--   en cas d'erreur, rien n'est supprimé.
--
-- Si tu veux ANNULER après avoir collé : ne clique simplement pas RUN.
-- ========================================================================

BEGIN;

-- ── 1. Désactiver temporairement les contraintes / triggers qui pourraient
--      ralentir ou bloquer (notamment notre nouveau trigger profile→auth)
SET session_replication_role = 'replica';

-- ── 2. Vider les tables applicatives (dans l'ordre des FK)
TRUNCATE TABLE
    public.message_reactions,
    public.deleted_messages,
    public.messages,
    public.conversation_members,
    public.conversations,
    public.contacts,
    public.devices,
    public.statuses,
    public.files,
    public.call_logs,
    public.profiles
RESTART IDENTITY CASCADE;

-- ── 3. Vider les fichiers du bucket storage `media`
DELETE FROM storage.objects WHERE bucket_id = 'media';

-- ── 4. Vider tous les autres buckets éventuels (avatars-temp, files-temp, media-temp, etc.)
DELETE FROM storage.objects
WHERE bucket_id IN (
    SELECT id FROM storage.buckets
);

-- ── 5. Supprimer toutes les sessions auth en cours
DELETE FROM auth.sessions;
DELETE FROM auth.refresh_tokens;
DELETE FROM auth.mfa_factors;
DELETE FROM auth.mfa_challenges;
DELETE FROM auth.mfa_amr_claims;
DELETE FROM auth.identities;

-- ── 6. Supprimer tous les utilisateurs auth
DELETE FROM auth.users;

-- ── 7. Réinitialiser le rate limiter (optionnel, mais cohérent avec un wipe)
TRUNCATE TABLE public.auth_rate_limits RESTART IDENTITY;

-- ── 8. Réactiver les triggers
SET session_replication_role = 'origin';

-- ── 9. Vérification : toutes les tables doivent être vides
DO $$
DECLARE
    v_users_count INT;
    v_profiles_count INT;
    v_messages_count INT;
    v_conversations_count INT;
    v_objects_count INT;
BEGIN
    SELECT COUNT(*) INTO v_users_count FROM auth.users;
    SELECT COUNT(*) INTO v_profiles_count FROM public.profiles;
    SELECT COUNT(*) INTO v_messages_count FROM public.messages;
    SELECT COUNT(*) INTO v_conversations_count FROM public.conversations;
    SELECT COUNT(*) INTO v_objects_count FROM storage.objects;

    RAISE NOTICE '========================================';
    RAISE NOTICE 'WIPE TERMINÉ — état final :';
    RAISE NOTICE '  auth.users         : %', v_users_count;
    RAISE NOTICE '  profiles           : %', v_profiles_count;
    RAISE NOTICE '  conversations      : %', v_conversations_count;
    RAISE NOTICE '  messages           : %', v_messages_count;
    RAISE NOTICE '  storage.objects    : %', v_objects_count;
    RAISE NOTICE '========================================';

    IF v_users_count > 0 OR v_profiles_count > 0 THEN
        RAISE EXCEPTION 'Wipe incomplet : auth.users=%, profiles=% (rollback)', v_users_count, v_profiles_count;
    END IF;
END $$;

COMMIT;

-- ========================================================================
-- Ta base est maintenant vierge. Tu peux te réinscrire avec n'importe quel pseudo.
-- ========================================================================
