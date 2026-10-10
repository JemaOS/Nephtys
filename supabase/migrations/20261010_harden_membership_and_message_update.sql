-- ============================================================================
-- Audit (2026-10-10) — durcissement des politiques d'appartenance (#6, #7)
-- ============================================================================
-- #6 : `cm_update_own`/`cm_update_self` autorisaient la modification de `role`
--      sans contrainte → un membre pouvait s'auto-promouvoir admin/owner.
--      Trigger : seul le créateur ou un admin/owner peut changer un rôle.
-- #7 : `messages_update_member` laissait tout membre modifier N'IMPORTE quel
--      message (contenu/médias/chiffré). Le client ne fait que `status`.
--      Trigger : un non-expéditeur ne peut changer que des champs non
--      compromettants (status, épinglage, star).
-- service_role (tâches système) reste autorisé.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.prevent_member_role_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND auth.role() <> 'service_role' THEN
    IF NOT (
      EXISTS (SELECT 1 FROM public.conversations c
              WHERE c.id = NEW.conversation_id AND c.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.conversation_members cm
                 WHERE cm.conversation_id = NEW.conversation_id
                   AND cm.user_id = auth.uid()
                   AND cm.role IN ('admin','owner'))
    ) THEN
      RAISE EXCEPTION 'Forbidden: cannot change member role';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_prevent_member_role_escalation ON public.conversation_members;
CREATE TRIGGER trg_prevent_member_role_escalation
  BEFORE UPDATE ON public.conversation_members
  FOR EACH ROW EXECUTE FUNCTION private.prevent_member_role_escalation();

CREATE OR REPLACE FUNCTION private.restrict_member_message_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF OLD.sender_id = auth.uid() THEN RETURN NEW; END IF;
  IF NEW.content        IS DISTINCT FROM OLD.content
     OR NEW.file_url     IS DISTINCT FROM OLD.file_url
     OR NEW.file_name    IS DISTINCT FROM OLD.file_name
     OR NEW.file_size    IS DISTINCT FROM OLD.file_size
     OR NEW.media_url    IS DISTINCT FROM OLD.media_url
     OR NEW.media_type   IS DISTINCT FROM OLD.media_type
     OR NEW.media_thumbnail IS DISTINCT FROM OLD.media_thumbnail
     OR NEW.media_width  IS DISTINCT FROM OLD.media_width
     OR NEW.media_height IS DISTINCT FROM OLD.media_height
     OR NEW.encryption_metadata IS DISTINCT FROM OLD.encryption_metadata
     OR NEW.is_text_encrypted  IS DISTINCT FROM OLD.is_text_encrypted
     OR NEW.is_media_encrypted IS DISTINCT FROM OLD.is_media_encrypted
     OR NEW.link_preview IS DISTINCT FROM OLD.link_preview
     OR NEW.deleted_at   IS DISTINCT FROM OLD.deleted_at
     OR NEW.is_deleted   IS DISTINCT FROM OLD.is_deleted
     OR NEW.edited_at    IS DISTINCT FROM OLD.edited_at
     OR NEW.is_edited    IS DISTINCT FROM OLD.is_edited
     OR NEW.sender_id    IS DISTINCT FROM OLD.sender_id
     OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
    RAISE EXCEPTION 'Forbidden: only status may be changed by non-senders';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_restrict_member_message_update ON public.messages;
CREATE TRIGGER trg_restrict_member_message_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.restrict_member_message_update();
