-- ============================================================================
-- 2026-10-30 — Correctifs d'audit (final) : RLS policies (items #1, #7, #9)
-- ============================================================================
-- Cette migration est le DERNIER mot sur les policies concernées (préfixe
-- 20261030 > 20261028 > 20261012). Elle corrige trois régressions d'ORDRE :
--
--   #1  `20261010_rls_hardening.sql` (r > h) recrée `cm_insert_self_or_member`
--       APRÈS le durcissement `20261010_harden_cm_insert_no_self_join.sql`, ce
--       qui rouvre l'auto-adhésion à une conversation arbitraire (IDOR messages :
--       s'insérer dans une conv dont on connaît l'id, puis lire ses messages).
--       → on ne garde QUE `cm_insert_creator_or_member` (sans user_id = auth.uid()).
--
--   #7  `conv_insert_self` (20260513_fix_conversation_update_rls.sql) accepte
--       `created_by IS NULL` (conversation orpheline).
--       → on ne garde QUE `conv_insert_creator` (created_by = auth.uid()).
--
--   #9  Policy `Allow profile creation` (1764463013_fix_profiles_rls_policies.sql)
--       autorise le rôle `anon` à insérer dans `profiles`, et `anon` détient
--       toujours INSERT/UPDATE/DELETE sur la table.
--       → DROP de la policy + REVOKE INSERT/UPDATE/DELETE à `anon`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- #1 — conversation_members : une seule policy INSERT, jamais d'auto-adhésion
-- ---------------------------------------------------------------------------

-- Suppression explicite des policies connues (dont la permissive recréée par
-- 20261010_rls_hardening.sql).
DROP POLICY IF EXISTS "cm_insert_self_or_member" ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_self"           ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert"                ON public.conversation_members;

-- Ceinture + bretelles : retirer TOUTE autre policy INSERT visant `authenticated`
-- (une policy inconnue recréée par un run divergé rouvrirait la faille).
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'conversation_members'
          AND cmd        = 'INSERT'
          AND 'authenticated' = ANY (roles)
          AND policyname <> 'cm_insert_creator_or_member'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_members', r.policyname);
    END LOOP;
END
$mig$;

-- On ne peut insérer un membre que si l'on est DÉJÀ membre de la conversation,
-- ou si l'on en est le créateur. AUCUNE branche `user_id = auth.uid()`.
DROP POLICY IF EXISTS "cm_insert_creator_or_member" ON public.conversation_members;
CREATE POLICY "cm_insert_creator_or_member"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
        private.is_conversation_member(conversation_id)
        OR EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND c.created_by = auth.uid()
        )
    );

-- ---------------------------------------------------------------------------
-- #7 — conversations : une seule policy INSERT, created_by = auth.uid() strict
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "conv_insert_self"    ON public.conversations;
DROP POLICY IF EXISTS "conv_insert"         ON public.conversations;

DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'conversations'
          AND cmd        = 'INSERT'
          AND 'authenticated' = ANY (roles)
          AND policyname <> 'conv_insert_creator'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversations', r.policyname);
    END LOOP;
END
$mig$;

-- Plus aucune branche `created_by IS NULL` : un créateur authentifié obligatoire.
DROP POLICY IF EXISTS "conv_insert_creator" ON public.conversations;
CREATE POLICY "conv_insert_creator"
    ON public.conversations FOR INSERT
    TO authenticated
    WITH CHECK (created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- #9 — profiles : plus d'INSERT anon, et retrait des privilèges d'écriture anon
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow profile creation" ON public.profiles;

REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon;
