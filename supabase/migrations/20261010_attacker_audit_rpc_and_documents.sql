-- ============================================================================
-- Audit attaquant (2026-10-10) — durcissement défensif
-- ============================================================================
-- 1) RPC destructrices SECURITY DEFINER : elles opéraient par id sans vérifier
--    l'appelant. L'ACL (postgres, service_role) les empêchait d'être appelées
--    par authenticated/anon, mais on ajoute les contrôles d'appartenance :
--    mine dormante désamorcée. service_role reste autorisé (tâches système).
-- 2) documents : la policy `view_authenticated_documents` (auth.role()=
--    'authenticated') laissait TOUT compte lire TOUTES les lignes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.edit_message(message_id uuid, new_content text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.messages
  SET content = new_content, edited_at = NOW(), is_edited = TRUE
  WHERE id = message_id
    AND deleted_at IS NULL
    AND (sender_id = auth.uid() OR auth.role() = 'service_role');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.soft_delete_message(message_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.messages
  SET deleted_at = NOW()
  WHERE id = message_id
    AND deleted_at IS NULL
    AND (sender_id = auth.uid() OR auth.role() = 'service_role');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.toggle_message_pin(message_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.messages m
  SET is_pinned = NOT m.is_pinned
  WHERE m.id = message_id
    AND (auth.role() = 'service_role' OR private.is_conversation_member(m.conversation_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
END; $function$;

DROP POLICY IF EXISTS "view_authenticated_documents" ON public.documents;
