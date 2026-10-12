-- ============================================================================
-- 2026-10-36 — conversation_members INSERT : créateur/admin + rôle forcé
-- ============================================================================
-- FAILLE (audit sec24, item #1) : la policy `cm_insert_creator_or_member`
-- (dernier mot = 20261030_audit_final_rls.sql:56-66) autorise encore TOUT
-- MEMBRE existant à insérer N'IMPORTE QUEL `user_id` avec N'IMPORTE QUEL
-- `role` — y compris `role = 'admin'`. Un simple membre pouvait donc :
--   • ajouter un tiers (ou un compte qu'il contrôle) en 'admin' → ESCALADE ;
--   • élargir la conversation à des comptes non désirés (IDOR de portée).
--
-- (Le durcissement 20261010_harden_cm_insert_no_self_join.sql n'avait fermé que
--  la branche `user_id = auth.uid()` d'auto-adhésion ; la branche
--  « n'importe quel membre » restait, elle, ouverte en écriture.)
--
-- CORRECTIF :
--   • Policy INSERT resserrée : seul le CRÉATEUR de la conversation OU un
--     membre 'admin'/'owner' peut insérer (plus de branche « membre quelconque »).
--   • Trigger BEFORE INSERT `trg_cm_force_member_role` : TOUTE insertion
--     cliente force `role = 'member'`. Aucun `INSERT` ne peut poser un rôle
--     privilégié — la promotion passe EXCLUSIVEMENT par un UPDATE, déjà gardé
--     par `trg_prevent_member_role_escalation` (créateur/admin/owner).
--
-- CONSÉQUENCE ASSUMÉE (documentée) : les flux de création qui insèrent le
-- créateur en 'admin' (GroupsPage.tsx:166, contactLink.ts:59) verront leur
-- ligne ramenée à 'member'. Le créateur reste PRIVILÉGIÉ car les policies le
-- reconnaissent via `conversations.created_by = auth.uid()` (conv_select_member,
-- cm_update_self_or_admin, cm_delete_self_or_creator) : son pouvoir ne dépend
-- pas de `conversation_members.role`. La promotion d'un membre se fait ensuite
-- par UPDATE (autorisé au créateur/admin).
--
-- Idempotente : DROP ... IF EXISTS puis (re)CREATE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Helper « admin/owner de la conversation » (SECURITY DEFINER → évite toute
--    récursion RLS sur conversation_members depuis la clause WITH CHECK).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_conversation_admin(p_conversation_id uuid)
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
          AND cm.role IN ('admin', 'owner')
    );
$$;

REVOKE ALL ON FUNCTION private.is_conversation_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.is_conversation_admin(uuid) TO authenticated;

COMMENT ON FUNCTION private.is_conversation_admin(uuid) IS
    'Vrai si auth.uid() est admin/owner de la conversation. SECURITY DEFINER (lecture conversation_members sans récursion RLS).';

-- ---------------------------------------------------------------------------
-- 2) Purge de TOUTES les policies INSERT connues ou divergentes.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "cm_insert_creator_or_member"  ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_self_or_member"      ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_self"                ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert"                     ON public.conversation_members;
DROP POLICY IF EXISTS "Users can join conversations"  ON public.conversation_members;
DROP POLICY IF EXISTS "cm_insert_creator_or_admin"    ON public.conversation_members;

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
          AND policyname <> 'cm_insert_creator_or_admin'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.conversation_members', r.policyname);
    END LOOP;
END
$mig$;

-- ---------------------------------------------------------------------------
-- 3) Policy INSERT unique : créateur OU admin/owner de la conversation.
-- ---------------------------------------------------------------------------
CREATE POLICY "cm_insert_creator_or_admin"
    ON public.conversation_members FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.conversations c
            WHERE c.id = conversation_id
              AND c.created_by = auth.uid()
        )
        OR private.is_conversation_admin(conversation_id)
    );

-- ---------------------------------------------------------------------------
-- 4) Trigger BEFORE INSERT : force `role = 'member'`.
--    Exemptions : service_role (tâches système) et absence de session
--    authentifiée (migrations/backfills exécutés par un rôle DB sans JWT).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.force_member_role_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
    IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;
    NEW.role := 'member';
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cm_force_member_role ON public.conversation_members;
CREATE TRIGGER trg_cm_force_member_role
    BEFORE INSERT ON public.conversation_members
    FOR EACH ROW EXECUTE FUNCTION private.force_member_role_on_insert();

COMMENT ON FUNCTION private.force_member_role_on_insert() IS
    'Force role = member à l''INSERT de conversation_members (sauf service_role / sans JWT). Ferme l''escalade de rôle par INSERT (item #1 sec24).';
