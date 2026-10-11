-- ============================================================================
-- 2026-10-11 — Autorisation de l'auteur sous expéditeur aveugle (Phase 1c)
-- ============================================================================
-- Depuis l'aveuglement de l'expéditeur, `messages.sender_id` est mis à NULL par
-- le trigger `zz_blind_message_sender` à CHAQUE insertion cliente. Résultat :
--   * `private.restrict_member_message_update` ne pouvait jamais reconnaître
--     l'auteur (`OLD.sender_id = auth.uid()` toujours faux) ;
--   * toute modification de SON PROPRE message (suppression « pour tout le
--     monde », édition) levait « Forbidden: only status may be changed… ».
-- Preuve prod : 0 message `sender_id IS NULL` n'a jamais de `deleted_at`,
-- alors que 76 messages historiques (sender_id non nul) en ont.
--
-- Correctif : l'auteur authentifié est enregistré dans une table PRIVÉE,
-- non exposée à PostgREST et sans aucune policy → le serveur reste aveugle
-- côté API/`messages`, mais peut autoriser l'auteur légitime de son message.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.message_authors (
  message_id uuid PRIMARY KEY REFERENCES public.messages(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Verrouillage : aucun accès client (ni lecture ni écriture).
ALTER TABLE private.message_authors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.message_authors FROM PUBLIC, anon, authenticated;

-- Enregistre l'auteur authentifié à l'insertion (AFTER INSERT : la ligne
-- `messages` doit exister pour respecter la clé étrangère).
CREATE OR REPLACE FUNCTION private.record_message_author()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO private.message_authors (message_id, author_id)
    VALUES (NEW.id, auth.uid())
    ON CONFLICT (message_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_record_message_author ON public.messages;
CREATE TRIGGER zz_record_message_author
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.record_message_author();

-- Autorisation d'édition/suppression : auteur réel (table privée) OU cas
-- historique où `sender_id` est renseigné.
CREATE OR REPLACE FUNCTION private.restrict_member_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  IF OLD.sender_id = auth.uid() THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.message_authors ma
    WHERE ma.message_id = OLD.id AND ma.author_id = auth.uid()
  ) THEN
    RETURN NEW;
  END IF;
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
END;
$function$;

-- RPC métier : autoriser l'auteur réel (table privée) en plus de sender_id.
CREATE OR REPLACE FUNCTION public.soft_delete_message(message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  UPDATE public.messages m
  SET deleted_at = NOW()
  WHERE m.id = message_id
    AND m.deleted_at IS NULL
    AND (
      m.sender_id = auth.uid()
      OR auth.role() = 'service_role'
      OR EXISTS (
        SELECT 1 FROM private.message_authors ma
        WHERE ma.message_id = m.id AND ma.author_id = auth.uid()
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.edit_message(message_id uuid, new_content text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','private'
AS $function$
BEGIN
  UPDATE public.messages m
  SET content = new_content, edited_at = NOW(), is_edited = TRUE
  WHERE m.id = message_id
    AND m.deleted_at IS NULL
    AND (
      m.sender_id = auth.uid()
      OR auth.role() = 'service_role'
      OR EXISTS (
        SELECT 1 FROM private.message_authors ma
        WHERE ma.message_id = m.id AND ma.author_id = auth.uid()
      )
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Forbidden: not your message';
  END IF;
END;
$function$;