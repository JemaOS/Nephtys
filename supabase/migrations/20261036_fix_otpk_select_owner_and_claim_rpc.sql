-- ============================================================================
-- 2026-10-36 — one_time_prekeys : SELECT owner-only + RPC de revendication
-- ============================================================================
-- FAILLE (audit sec24, item #3) : la policy `otpk_select_available`
-- (20261010_ratchet_prekeys.sql:46-50) expose TOUTES les prekeys libres de
-- TOUS les utilisateurs aux comptes authentifiés :
--     USING (is_used = false OR user_id = auth.uid())
-- Conséquences :
--   • ÉNUMÉRATION : un compte peut lister `(id, public_key, user_id)` des OPK
--     libres d'autrui (métadonnées + IDs) ;
--   • DRAIN / DoS : il peut appeler la consommation atomique sur des IDs
--     découverts et BRÛLER les OPK d'un pair (déni de forward secrecy).
--
-- CORRECTIF :
--   • Lecture restreinte au PROPRIÉTAIRE : `USING (user_id = auth.uid())`.
--     Plus aucune lecture des OPK d'un pair via la table (fin de l'énumération).
--   • Les OPK d'un PAIR ne sont accessibles QUE par un RPC atomique
--     `claim_one_time_prekey(p_user_id)` (SECURITY DEFINER) qui SÉLECTIONNE et
--     CONSOMME en une seule requête (`FOR UPDATE SKIP LOCKED`) et ne renvoie que
--     le `public_key` — jamais l'`id`, jamais de listing.
--
-- NOTE CLIENT (hors périmètre SQL) : `claimOneTimePreKeyForPeer`
-- (src/lib/ratchet/keyStore.ts:188-220) pré-sélectionne aujourd'hui les
-- candidats d'un pair (`.select('id, public_key')`), ce que la nouvelle policy
-- interdira (0 ligne → aucune OPK négociée, sans erreur). Il devra appeler
-- `rpc('claim_one_time_prekey', { p_user_id: peerId })`. Le RPC
-- `consume_one_time_prekey(p_prekey_id)` (20261012) reste en place, mais l'`id`
-- d'un pair n'étant plus découvrable, il ne sert plus qu'au propriétaire.
--
-- Idempotente : DROP ... IF EXISTS puis (re)CREATE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) SELECT : le propriétaire uniquement.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "otpk_select_available" ON public.one_time_prekeys;
DROP POLICY IF EXISTS "otpk_select_own"        ON public.one_time_prekeys;

CREATE POLICY "otpk_select_own"
    ON public.one_time_prekeys FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2) RPC de revendication atomique d'une OPK d'un PAIR.
--    - sélection + consommation en une requête (FOR UPDATE SKIP LOCKED) :
--      deux initiateurs concurrents obtiennent des OPK distinctes ;
--    - ne renvoie que `public_key` (NULL si aucune OPK libre) ;
--    - refuse le propriétaire (qui gère ses OPK via la table + RLS).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_one_time_prekey(p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
    v_public_key text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Forbidden: authentication required';
    END IF;

    -- Le propriétaire gère ses propres prekeys via la table (RLS owner-only)
    -- et ne doit pas emprunter ce chemin « pair ».
    IF p_user_id IS NULL OR p_user_id = auth.uid() THEN
        RETURN NULL;
    END IF;

    UPDATE public.one_time_prekeys
       SET is_used = true
     WHERE id = (
         SELECT id
         FROM public.one_time_prekeys
         WHERE user_id = p_user_id
           AND is_used = false
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
     )
    RETURNING public_key INTO v_public_key;

    -- NULL si aucune OPK libre (ou course perdue) : l'appelant continue sans
    -- OPK ou retente.
    RETURN v_public_key;
END;
$fn$;

REVOKE ALL ON FUNCTION public.claim_one_time_prekey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_one_time_prekey(uuid) TO authenticated;

COMMENT ON FUNCTION public.claim_one_time_prekey(uuid) IS
    'Réclame atomiquement UNE one-time prekey libre d''un pair (sélection + consommation, FOR UPDATE SKIP LOCKED) et renvoie son public_key (NULL si aucune). Seul chemin d''accès aux OPK d''un pair depuis le durcissement owner-only (item #3 sec24).';
