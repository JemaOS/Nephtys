-- ============================================================================
-- Fix warnings de sécurité SECURITY DEFINER
-- ============================================================================
--
-- Trois fonctions SECURITY DEFINER étaient exposées aux utilisateurs
-- authentifiés via l'API REST (/rest/v1/rpc/...). Ce patch :
--
--   1. can_access_media     → SECURITY INVOKER (auth.uid() suffit)
--                             + REVOKE EXECUTE pour sortir de l'API REST
--   2. is_conversation_member → garde SECURITY DEFINER (nécessaire pour
--                             éviter la récursion RLS), mais REVOKE EXECUTE
--                             sur authenticated → plus appelable via REST,
--                             seulement via le planner Postgres (policies)
--   3. mark_messages_as_read → reste appelable via REST mais :
--                             - ignore le paramètre p_user_id (on force
--                               auth.uid() pour qu'un user ne puisse pas
--                               marquer les messages d'un autre)
--                             - vérifie que l'appelant est bien membre
--                               de la conversation avant de modifier quoi
--                               que ce soit
-- ============================================================================


-- 1) can_access_media → SECURITY INVOKER + hors API REST ----------------
--
-- La fonction utilise auth.uid() qui fonctionne bien en INVOKER.
-- On la déplace dans le schema "extensions" ou on revoke simplement
-- l'EXECUTE pour authenticated. Comme elle est utilisée dans une policy
-- storage, elle reste invocable par le planner.

CREATE OR REPLACE FUNCTION public.can_access_media(p_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER          -- ← changé : plus besoin de DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid      uuid := auth.uid();
    v_parts    text[];
    v_folder   text;
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

-- Retirer l'accès REST : les policies storage appellent cette fonction
-- via le planner (role = supabase_storage_admin / postgres), pas via authenticated.
REVOKE ALL  ON FUNCTION public.can_access_media(text) FROM PUBLIC, anon, authenticated;
-- Pas de GRANT authenticated → plus accessible via /rpc/can_access_media


-- 2) is_conversation_member → REVOKE EXECUTE sur authenticated ----------
--
-- Cette fonction doit rester SECURITY DEFINER pour que les policies RLS
-- évitent la récursion infinie (le planner l'appelle en tant que postgres).
-- Mais les utilisateurs authentifiés ne doivent PAS pouvoir l'appeler
-- directement via /rpc/.

REVOKE EXECUTE ON FUNCTION public.is_conversation_member(uuid)
    FROM PUBLIC, anon, authenticated;
-- Le planner Postgres exécute les policies avec le rôle postgres/owner
-- qui a toujours l'accès → les RLS continuent de fonctionner.


-- 3) mark_messages_as_read → sécuriser contre l'usurpation d'identité ---
--
-- On ignore le paramètre p_user_id et on utilise auth.uid() pour s'assurer
-- qu'un utilisateur ne peut marquer que ses propres messages comme lus.
-- On vérifie aussi qu'il est membre de la conversation cible.

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
    p_conversation_id uuid,
    p_user_id         uuid   -- conservé pour rétrocompatibilité API mais IGNORÉ
)
RETURNS TABLE(updated_count int)
LANGUAGE plpgsql
SECURITY DEFINER            -- requis pour bypass RLS sur messages
SET search_path = public
AS $$
DECLARE
    v_caller  uuid := auth.uid();
    v_count   int;
BEGIN
    -- Sécurité : seul l'utilisateur connecté peut marquer ses propres messages
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Vérifier que le caller est bien membre de la conversation
    IF NOT EXISTS (
        SELECT 1
        FROM public.conversation_members cm
        WHERE cm.conversation_id = p_conversation_id
          AND cm.user_id = v_caller
    ) THEN
        RAISE EXCEPTION 'Access denied: not a member of this conversation';
    END IF;

    -- Met à jour uniquement les messages destinés à v_caller (pas les siens)
    UPDATE public.messages
    SET status = 'read'
    WHERE conversation_id = p_conversation_id
      AND sender_id <> v_caller
      AND status <> 'read';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT v_count;
END;
$$;

-- Reste appelable via REST par les utilisateurs authentifiés
REVOKE ALL   ON FUNCTION public.mark_messages_as_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.mark_messages_as_read IS
    'Marque les messages d''une conversation comme lus pour l''utilisateur CONNECTÉ '
    '(auth.uid()). Le paramètre p_user_id est ignoré pour des raisons de sécurité. '
    'Vérifie que l''appelant est membre de la conversation.';
