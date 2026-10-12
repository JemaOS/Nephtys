-- ============================================================================
-- 2026-10-36 — Trigger UPDATE `messages` : denylist complétée
-- ============================================================================
-- FAILLE (audit sec24, item #4) : `private.restrict_member_message_update`
-- (dernière version = 20261033_reduce_message_authors.sql:210-263) liste les
-- colonnes INTERDITES aux non-auteurs, mais oublie quatre colonnes modifiables
-- par tout MEMBRE de la conversation (policy UPDATE `messages_update_member`) :
--     created_at, updated_at, is_starred, is_pinned
-- Un non-auteur pouvait donc réécrire l'HORODATAGE d'un message (created_at /
-- updated_at → fausse chronologie, contournement des tris / de la purge de
-- rétention) et l'état partagé is_starred / is_pinned d'autrui.
--
-- CORRECTIF : on REJOUE la fonction COMPLÈTE de 20261033 (auteur reconnu par
-- `private.message_authors.author_ref` — pseudonyme HMAC, jamais l'UUID brut)
-- en AJOUTANT les quatre colonnes à la denylist.
--
-- Comportement inchangé par ailleurs :
--   • `service_role` (tâches système) reste autorisé ;
--   • l'auteur réel (sender_id historique OU author_ref) reste autorisé ;
--   • seul `status` (et champs non compromettants non listés) reste modifiable
--     par un non-auteur.
--
-- NOTE : `messages.is_starred` / `is_pinned` sont des colonnes PARTAGÉES
-- dépréciées (remplacées par `public.message_user_state`, cf. 20261031) : les
-- y ajouter ne casse pas le chemin moderne (écriture dans message_user_state).
-- Le repli rétrocompat client (écriture directe dans `messages` si
-- `message_user_state` est absente, ChatViewPage.tsx:541-551) serait, lui,
-- refusé pour un non-auteur — correction de sécurité assumée et documentée.
--
-- Idempotente : CREATE OR REPLACE + DROP/CREATE du trigger.
-- ============================================================================

CREATE OR REPLACE FUNCTION private.restrict_member_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path to 'public', 'private'
AS $function$
BEGIN
  IF auth.role() = 'service_role' THEN RETURN NEW; END IF;

  -- Auteur historique (sender_id encore renseigné) ou auteur réel (pseudonyme).
  IF OLD.sender_id = auth.uid() THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM private.message_authors ma
    WHERE ma.message_id = OLD.id
      AND ma.author_ref IS NOT NULL
      AND ma.author_ref = private.author_ref(auth.uid())
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.content             IS DISTINCT FROM OLD.content
     OR NEW.file_url         IS DISTINCT FROM OLD.file_url
     OR NEW.file_name        IS DISTINCT FROM OLD.file_name
     OR NEW.file_size        IS DISTINCT FROM OLD.file_size
     OR NEW.media_url        IS DISTINCT FROM OLD.media_url
     OR NEW.media_type       IS DISTINCT FROM OLD.media_type
     OR NEW.media_thumbnail  IS DISTINCT FROM OLD.media_thumbnail
     OR NEW.media_width      IS DISTINCT FROM OLD.media_width
     OR NEW.media_height     IS DISTINCT FROM OLD.media_height
     OR NEW.encryption_metadata IS DISTINCT FROM OLD.encryption_metadata
     OR NEW.is_text_encrypted   IS DISTINCT FROM OLD.is_text_encrypted
     OR NEW.is_media_encrypted  IS DISTINCT FROM OLD.is_media_encrypted
     OR NEW.link_preview     IS DISTINCT FROM OLD.link_preview
     OR NEW.deleted_at       IS DISTINCT FROM OLD.deleted_at
     OR NEW.is_deleted       IS DISTINCT FROM OLD.is_deleted
     OR NEW.edited_at        IS DISTINCT FROM OLD.edited_at
     OR NEW.is_edited        IS DISTINCT FROM OLD.is_edited
     OR NEW.sender_id        IS DISTINCT FROM OLD.sender_id
     OR NEW.conversation_id  IS DISTINCT FROM OLD.conversation_id
     OR NEW.sender_sealed    IS DISTINCT FROM OLD.sender_sealed
     OR NEW.sender_name      IS DISTINCT FROM OLD.sender_name
     OR NEW.sender_avatar    IS DISTINCT FROM OLD.sender_avatar
     OR NEW.profiles         IS DISTINCT FROM OLD.profiles
     OR NEW.reply_to_id      IS DISTINCT FROM OLD.reply_to_id
     OR NEW.type             IS DISTINCT FROM OLD.type
     OR NEW.is_ephemeral     IS DISTINCT FROM OLD.is_ephemeral
     OR NEW.ephemeral_duration    IS DISTINCT FROM OLD.ephemeral_duration
     OR NEW.ephemeral_expires_at  IS DISTINCT FROM OLD.ephemeral_expires_at
     -- Colonnes ajoutées (audit sec24 #4) : horodatages et état partagé.
     OR NEW.created_at       IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at       IS DISTINCT FROM OLD.updated_at
     OR NEW.is_starred       IS DISTINCT FROM OLD.is_starred
     OR NEW.is_pinned        IS DISTINCT FROM OLD.is_pinned THEN
    RAISE EXCEPTION 'Forbidden: only status may be changed by non-senders';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_restrict_member_message_update ON public.messages;
CREATE TRIGGER trg_restrict_member_message_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION private.restrict_member_message_update();
