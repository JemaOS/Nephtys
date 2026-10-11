-- ============================================================================
-- 20261012 — one_time_prekeys : consommation atomique via RPC SECURITY DEFINER
-- ============================================================================
-- Problème : la policy `otpk_update_consume` (20261010_ratchet_prekeys.sql:59-64,
-- recréée par 20261010_revoke_anon_key_exposure.sql:40-43) autorisait TOUT
-- compte authentifié à UPDATE N'IMPORTE QUELLE ligne de `one_time_prekeys`
-- (donc à réécrire `public_key`, `user_id`, etc. des prekeys d'autrui) — au
-- mieux un DoS de session, au pire une corruption d'intégrité X3DH.
--
-- Correctif : on supprime cette policy large et on expose un RPC atomique qui
-- réclame UNE seule ligne libre (`is_used = false → true`) et ne renvoie que
-- `public_key` (jamais modifiable par l'appelant).
--
-- Conservé (owner-scopé) :
--   • otpk_select_available  (initiateurs + propriétaire)
--   • otpk_insert_own        (propriétaire)
--   • otpk_update_own        (propriétaire : nécessaire au upsert de publishKeys
--                             qui remet is_used=false sur SES propres prekeys —
--                             cf. src/lib/ratchet/keyStore.ts:104-107)
--   • otpk_delete_own        (propriétaire)
--
-- NOTE CLIENT (hors périmètre SQL) : `markOneTimePreKeyUsed(peerId, publicKey)`
-- (src/lib/ratchet/keyStore.ts:157-163) fait aujourd'hui un UPDATE direct. Il
-- devra être migré vers `rpc('consume_one_time_prekey', { p_prekey_id })`. Tant
-- que ce n'est pas fait, l'UPDATE direct renverra 0 ligne (échec silencieux,
-- pas d'erreur) — aucune casse applicative, mais la prekey ne sera pas marquée
-- consommée.
-- ============================================================================

-- 1) Supprimer la policy de consommation large
DROP POLICY IF EXISTS "otpk_update_consume" ON public.one_time_prekeys;

-- 2) RPC atomique de consommation
CREATE OR REPLACE FUNCTION public.consume_one_time_prekey(p_prekey_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $fn$
DECLARE
    v_public_key text;
BEGIN
    UPDATE public.one_time_prekeys
       SET is_used = true
     WHERE id = p_prekey_id
       AND is_used = false
    RETURNING public_key INTO v_public_key;

    -- NULL si la prekey est déjà consommée ou inexistante : l'appelant ne
    -- peut ni modifier public_key, ni « réinitialiser » une prekey.
    RETURN v_public_key;
END;
$fn$;

REVOKE ALL ON FUNCTION public.consume_one_time_prekey(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consume_one_time_prekey(uuid) TO authenticated;

COMMENT ON FUNCTION public.consume_one_time_prekey(uuid) IS
    'Réclame atomiquement UNE one-time prekey (is_used false -> true) et renvoie son public_key (NULL si déjà consommée).';
