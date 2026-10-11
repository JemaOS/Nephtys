-- ============================================================================
-- 2026-10-31 — État message PAR UTILISATEUR (étoile / épingle)
-- ============================================================================
-- `messages.is_starred` et `messages.is_pinned` sont des colonnes PARTAGÉES :
-- quand un participant étoile/épingle un message, l'état devient global (étoilé
-- /épinglé « pour tout le monde »). C'est un bug de modèle : l'étoile et
-- l'épingle sont des préférences personnelles.
--
-- Cette migration introduit `public.message_user_state`, clé (message_id,
-- user_id), avec RLS limitée à `user_id = auth.uid()`. Les colonnes partagées
-- `messages.is_starred` / `is_pinned` restent en place (rétrocompat) mais ne
-- sont plus lues/écrites par le client : elles servent uniquement de repli si
-- cette table n'existe pas encore (prod non migrée).
--
-- Idempotente. Backfill best-effort de l'état existant vers l'AUTEUR RÉEL
-- (`private.message_authors`), sinon repli sur `messages.sender_id` ; les
-- colonnes `is_starred`/`pinned_until` de `messages` ne sont pas modifiées.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table d'état par utilisateur
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.message_user_state (
  message_id   uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL,
  is_starred   boolean     NOT NULL DEFAULT false,
  is_pinned    boolean     NOT NULL DEFAULT false,
  pinned_until timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. RLS : chacun ne voit et ne modifie que ses propres lignes
-- ---------------------------------------------------------------------------

ALTER TABLE public.message_user_state ENABLE ROW LEVEL SECURITY;

-- Privilèges explicites (idempotents) : rien pour `anon`, tout pour l'utilisateur
-- authentifié (ensuite restreint ligne à ligne par RLS).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_user_state TO authenticated;
REVOKE ALL ON public.message_user_state FROM anon;

DROP POLICY IF EXISTS "mus_select_own" ON public.message_user_state;
CREATE POLICY "mus_select_own"
    ON public.message_user_state FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

DROP POLICY IF EXISTS "mus_insert_own" ON public.message_user_state;
CREATE POLICY "mus_insert_own"
    ON public.message_user_state FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "mus_update_own" ON public.message_user_state;
CREATE POLICY "mus_update_own"
    ON public.message_user_state FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "mus_delete_own" ON public.message_user_state;
CREATE POLICY "mus_delete_own"
    ON public.message_user_state FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Index per-user (filtres « mes messages étoilés / épinglés »)
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_message_user_state_user_starred
    ON public.message_user_state (user_id, is_starred);

CREATE INDEX IF NOT EXISTS idx_message_user_state_user_pinned
    ON public.message_user_state (user_id, is_pinned);

-- ---------------------------------------------------------------------------
-- 4. Backfill best-effort (rétrocompat) — état partagé → ligne de l'AUTEUR
-- ---------------------------------------------------------------------------
-- But : ne pas perdre l'état étoilé/épinglé existant côté prod, en l'attribuant
-- à l'auteur réel du message (les autres participants démarrent à false — c'est
-- le comportement voulu : plus de propagation globale).
--
-- a) Auteur réel = `private.message_authors.author_id` (Phase 1c, expéditeur
--    aveugle) quand la table existe ;
-- b) sinon repli sur `messages.sender_id` (messages historiques non aveuglés) ;
-- c) `sender_id` NULL et pas d'auteur privé → non recopiable (on documente :
--    ces lignes rares ne sont pas backfillées, l'utilisateur les ré-étoilera).
--
-- Idempotent : ON CONFLICT DO NOTHING (relancer ne crée aucun doublon).
DO $mig$
BEGIN
  IF to_regclass('private.message_authors') IS NOT NULL THEN
    INSERT INTO public.message_user_state
      (message_id, user_id, is_starred, is_pinned, pinned_until, updated_at)
    SELECT
      m.id,
      COALESCE(ma.author_id, m.sender_id) AS user_id,
      COALESCE(m.is_starred, false),
      COALESCE(m.is_pinned, false),
      m.pinned_until,
      now()
    FROM public.messages m
    LEFT JOIN private.message_authors ma ON ma.message_id = m.id
    WHERE (m.is_starred IS TRUE OR m.is_pinned IS TRUE)
      AND COALESCE(ma.author_id, m.sender_id) IS NOT NULL
    ON CONFLICT (message_id, user_id) DO NOTHING;
  ELSE
    INSERT INTO public.message_user_state
      (message_id, user_id, is_starred, is_pinned, pinned_until, updated_at)
    SELECT
      m.id,
      m.sender_id,
      COALESCE(m.is_starred, false),
      COALESCE(m.is_pinned, false),
      m.pinned_until,
      now()
    FROM public.messages m
    WHERE (m.is_starred IS TRUE OR m.is_pinned IS TRUE)
      AND m.sender_id IS NOT NULL
    ON CONFLICT (message_id, user_id) DO NOTHING;
  END IF;
END
$mig$;

COMMENT ON TABLE public.message_user_state IS
  'État par utilisateur (étoile / épingle) d''un message. Remplace les colonnes partagées messages.is_starred / is_pinned.';
