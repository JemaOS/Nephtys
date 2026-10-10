-- ============================================================================
-- Phase 1c (centralisé) — aveuglement de l'expéditeur à l'INSERTION
-- ============================================================================
-- Garantit que TOUS les messages insérés (texte, média, audio, transfert…) sont
-- stockés sans identité d'expéditeur, quelle que soit la voie client. L'identité
-- est portée par `sender_sealed` (authentifié, vérifié côté client).
-- service_role (système) est préservé.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.blind_message_sender()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;
  NEW.sender_id := NULL;
  NEW.sender_name := NULL;
  NEW.sender_avatar := NULL;
  NEW.profiles := NULL;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS zz_blind_message_sender ON public.messages;
CREATE TRIGGER zz_blind_message_sender
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.blind_message_sender();
