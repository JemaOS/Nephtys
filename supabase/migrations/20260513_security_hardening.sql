-- ====================================================================
-- Security Hardening — corrige les warnings du Supabase Database Linter
-- ====================================================================
-- Couvre :
--   1. RLS conversation_members : remplace les policies "ALL true" par
--      des policies non-récursives basées sur la membership
--   2. Bucket storage `media` : retire la SELECT policy qui permet le
--      listing public (les URLs publiques continuent de fonctionner)
--   3. Fonctions SECURITY DEFINER : révoque EXECUTE pour anon/authenticated
--      sur tous les triggers/RPC qui ne doivent pas être appelés en REST,
--      et durcit les RPC métier (edit_message, soft_delete_message, …)
--   4. Drop la fonction obsolète `authenticate_user` (fuite de hash)
-- ====================================================================

-- ====================================================================
-- 1) RLS conversation_members
-- --------------------------------------------------------------------
-- Stratégie anti-récursivité : utiliser une fonction STABLE
-- SECURITY DEFINER pour vérifier la membership, qui bypasse la RLS
-- de la table cible. Permet des policies expressives sans boucle.
-- ====================================================================

-- Fonction utilitaire : l'utilisateur courant est-il membre de cette conversation ?
CREATE OR REPLACE FUNCTION public.is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id = p_conversation_id
          AND cm.user_id = auth.uid()
    );
$$;

-- Cette fonction est un helper interne ; on la verrouille
REVOKE ALL ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;
-- (Note : authenticated peut l'appeler car les policies RLS ci-dessous l'utilisent
--  implicitement via le planner — pas via REST.)

-- Drop des policies actuelles
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN (SELECT policyname FROM pg_policies WHERE tablename = 'conversation_members' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS "' || r.policyname || '" ON public.conversation_members';
    END LOOP;
END $$;

-- service_role : accès total (utilisé par les edge functions)
CREATE POLICY "cm_all_service_role"
    ON public.conversation_members
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- SELECT : on peut lire les memberships si on est soi-même membre de la conversation
CREATE POLICY "cm_select_member"
    ON public.conversation_members
    FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(conversation_id));

-- INSERT : autorisé si
--   • on s'ajoute soi-même (user_id = auth.uid()), OU
--   • on est déjà membre de la conversation, OU
--   • on est le créateur de la conversation (cas batch insert lors de la création d'un groupe :
--     la première ligne du batch n'a pas encore été committée pour les lignes suivantes)
CREATE POLICY "cm_insert_self_or_member"
    ON public.conversation_members
    FOR INSERT
    TO authenticated
    WITH CHECK (
        user_id = auth.uid()
        OR public.is_conversation_member(conversation_id)
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND c.created_by = auth.uid()
        )
    );

-- UPDATE : on ne peut modifier QUE sa propre ligne (mute, archive, pin, last_read…)
CREATE POLICY "cm_update_own"
    ON public.conversation_members
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- DELETE : on peut se retirer soi-même OU retirer un membre d'une conv où on est admin
CREATE POLICY "cm_delete_own_or_admin"
    ON public.conversation_members
    FOR DELETE
    TO authenticated
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.conversation_members cm_admin
            WHERE cm_admin.conversation_id = conversation_members.conversation_id
              AND cm_admin.user_id = auth.uid()
              AND cm_admin.role IN ('admin', 'owner')
        )
    );

-- ====================================================================
-- 2) Bucket storage `media`
-- --------------------------------------------------------------------
-- Le warning : "Public bucket allows listing" car il existe une SELECT
-- policy `Public media access`. Sur un bucket public, les URLs publiques
-- (getPublicUrl) marchent SANS policy SELECT. La policy actuelle ne
-- sert qu'à autoriser `storage.from('media').list()`, qui n'est jamais
-- utilisé par l'app (vérifié). On la supprime.
-- Les URLs publiques existantes continueront à fonctionner.
-- ====================================================================

DROP POLICY IF EXISTS "Public media access" ON storage.objects;

-- ====================================================================
-- 3) Fonctions SECURITY DEFINER — révocation de EXECUTE
-- --------------------------------------------------------------------
-- Les fonctions ci-dessous sont soit :
--   • des triggers internes qui ne doivent JAMAIS être appelés en REST
--   • des RPC métier dont la version actuelle est trop permissive
--
-- On révoque EXECUTE pour anon/authenticated. Les triggers continuent
-- de s'exécuter normalement (ils utilisent les privilèges du propriétaire).
-- Les RPC client devront passer par le code applicatif (UPDATE direct
-- avec RLS) qui est plus sûr.
-- ====================================================================

-- 3a. Triggers internes (jamais appelés en REST)
DO $$
DECLARE
    fn_signature TEXT;
    fn_signatures TEXT[] := ARRAY[
        'public.denormalize_sender_info()',
        'public.sync_sender_info_to_message()',
        'public.handle_new_message_update_conversation()',
        'public.fill_ghost_profile()'
    ];
BEGIN
    FOREACH fn_signature IN ARRAY fn_signatures LOOP
        BEGIN
            EXECUTE 'REVOKE ALL ON FUNCTION ' || fn_signature || ' FROM PUBLIC, anon, authenticated';
        EXCEPTION WHEN undefined_function THEN
            -- La fonction n'existe pas (selon les déploiements), on ignore
            RAISE NOTICE 'Function % does not exist, skipping', fn_signature;
        END;
    END LOOP;
END $$;

-- 3b. RPC métier — révoquer EXECUTE pour les versions actuelles non sécurisées.
-- Ces fonctions n'étaient pas appelées par le client (vérifié) → safe à bloquer.
-- Si tu veux les réactiver plus tard, il faudra les corriger pour vérifier
-- que auth.uid() = sender_id avant de muter le message.
DO $$
DECLARE
    fn_signature TEXT;
    fn_signatures TEXT[] := ARRAY[
        'public.edit_message(uuid, text)',
        'public.soft_delete_message(uuid)',
        'public.toggle_message_pin(uuid)',
        'public.delete_expired_ephemeral_messages()'
    ];
BEGIN
    FOREACH fn_signature IN ARRAY fn_signatures LOOP
        BEGIN
            EXECUTE 'REVOKE ALL ON FUNCTION ' || fn_signature || ' FROM PUBLIC, anon, authenticated';
        EXCEPTION WHEN undefined_function THEN
            RAISE NOTICE 'Function % does not exist, skipping', fn_signature;
        END;
    END LOOP;
END $$;

-- 3c. Rate-limit RPCs (anti-DDoS) — service_role only
DO $$
DECLARE
    fn_signature TEXT;
    fn_signatures TEXT[] := ARRAY[
        'public.check_and_record_rate_limit(text, text, text, integer, integer)',
        'public.purge_auth_rate_limits()'
    ];
BEGIN
    FOREACH fn_signature IN ARRAY fn_signatures LOOP
        BEGIN
            EXECUTE 'REVOKE ALL ON FUNCTION ' || fn_signature || ' FROM PUBLIC, anon, authenticated';
            EXECUTE 'GRANT EXECUTE ON FUNCTION ' || fn_signature || ' TO service_role';
        EXCEPTION WHEN undefined_function THEN
            RAISE NOTICE 'Function % does not exist, skipping', fn_signature;
        END;
    END LOOP;
END $$;

-- ====================================================================
-- 4) Drop de la fonction obsolète `authenticate_user`
-- --------------------------------------------------------------------
-- Cette fonction (1764463341_update_auth_pseudo_only.sql) :
--   • compare le password en clair avec le hash de la table profiles
--     ⇒ permet à n'importe qui d'extraire les hashes via timing attack
--   • n'est plus utilisée (remplacée par l'edge function auth-with-username)
-- ====================================================================

DROP FUNCTION IF EXISTS public.authenticate_user(p_username text, p_password text);

-- ====================================================================
-- Notes opérationnelles
-- --------------------------------------------------------------------
-- Le warning « auth_leaked_password_protection » ne se corrige PAS via
-- migration SQL : il faut l'activer dans le Dashboard :
--   Authentication → Providers → Email → "Leaked password protection"
-- ====================================================================
