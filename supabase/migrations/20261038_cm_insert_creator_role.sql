-- ============================================================================
-- 2026-10-38 — conversation_members INSERT : préserver le rôle du CRÉATEUR
-- ============================================================================
-- CONTEXTE
--   La migration 20261036_fix_cm_insert_role_binding.sql a fermé l'escalade de
--   rôle par INSERT (item #1 sec24) en forçant `NEW.role := 'member'` pour
--   TOUTE insertion cliente. Correct côté sécurité, mais trop large : les flux
--   de création insèrent le CRÉATEUR avec `role = 'admin'` :
--     • src/pages/GroupsPage.tsx:166        (créateur d'un groupe)
--     • src/lib/contactLink.ts:59           (créateur d'une conv. directe)
--     • src/pages/ContactsPage.tsx:156,162  (conv. auto)
--     • src/pages/CallsPage.tsx:829,835,895 (conv. d'appel)
--   Résultat : le créateur était ramené à 'member'. Ses privilèges SERVEUR
--   restent intacts (les policies le reconnaissent via conversations.created_by),
--   mais l'UI de gestion de groupe teste `role === 'admin'` et pouvait donc ne
--   plus afficher les actions d'admin (régression d'UX).
--
-- OBJECTIF : préserver l'UX SANS rouvrir la faille.
--   Trigger BEFORE INSERT `trg_cm_force_member_role` (fonction
--   private.force_member_role_on_insert) :
--     • service_role OU pas de session (auth.uid() IS NULL) → inchangé (exempt) ;
--     • NEW.user_id = conversations.created_by (ligne DÉDIÉE au créateur) →
--       on conserve NEW.role tel quel, plafonné à 'admin' ;
--     • sinon (tout autre membre inséré par le créateur ou un admin/owner) →
--       NEW.role := 'member' (inchangé : aucune escalade possible).
--
-- POURQUOI LA FAILLE RESTE FERMÉE
--   Le seul `user_id` pouvant porter 'admin' via INSERT est celui du créateur de
--   la conversation (comparaison stricte NEW.user_id = created_by). Un membre ne
--   peut donc PAS s'auto-promouvoir ni promouvoir un tiers : la ligne d'un tiers
--   a NEW.user_id ≠ created_by → forcée 'member'. Ajouter la ligne du créateur
--   en 'admin' n'accorde rien de plus (le créateur possède déjà ces droits via
--   `conversations.created_by`). La promotion d'un tiers reste réservée à
--   l'UPDATE, gardé par `trg_prevent_member_role_escalation` (NON modifié ici).
--
--   Note schéma : la contrainte CHECK de conversation_members n'accepte que
--   ('admin','member') (1764462225_create_conversation_members_table.sql:9).
--   Le plafonnement défensif à 'admin' de la branche créateur n'est donc jamais
--   requis aujourd'hui, mais garantit « au plus admin » même si la contrainte
--   venait à s'élargir.
--
-- Idempotente : CREATE OR REPLACE de la fonction + DROP TRIGGER IF EXISTS puis
-- (re)CREATE. Ne touche NI la policy INSERT (`cm_insert_creator_or_admin`) NI le
-- trigger UPDATE `trg_prevent_member_role_escalation`.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.force_member_role_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
    v_is_creator boolean;
BEGIN
    -- Exemptions système : tâches service_role et exécution sans session
    -- authentifiée (migrations / backfills par un rôle DB sans JWT).
    IF auth.role() = 'service_role' OR auth.uid() IS NULL THEN
        RETURN NEW;
    END IF;

    -- La ligne insérée est-elle celle du CRÉATEUR de la conversation ?
    SELECT EXISTS (
        SELECT 1
        FROM public.conversations c
        WHERE c.id = NEW.conversation_id
          AND c.created_by = NEW.user_id
    ) INTO v_is_creator;

    IF v_is_creator THEN
        -- Créateur : on autorise son rôle tel quel, plafonné à 'admin'.
        IF NEW.role IS NULL OR NEW.role NOT IN ('admin', 'member') THEN
            NEW.role := 'admin';
        END IF;
    ELSE
        -- Tout autre membre inséré : rôle forcé à 'member' (anti-escalade).
        NEW.role := 'member';
    END IF;

    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_cm_force_member_role ON public.conversation_members;
CREATE TRIGGER trg_cm_force_member_role
    BEFORE INSERT ON public.conversation_members
    FOR EACH ROW EXECUTE FUNCTION private.force_member_role_on_insert();

COMMENT ON FUNCTION private.force_member_role_on_insert() IS
    'BEFORE INSERT conversation_members : force role = ''member'' sauf pour la ligne du créateur (NEW.user_id = conversations.created_by, rôle conservé, plafonné à ''admin'') et sauf service_role / sans JWT. Ferme l''escalade de rôle par INSERT (item #1 sec24) tout en préservant l''UX admin du créateur.';
