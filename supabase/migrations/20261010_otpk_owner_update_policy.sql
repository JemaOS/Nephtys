-- ============================================================================
-- Correction de régression : policy propriétaire sur one_time_prekeys
-- ============================================================================
-- Le durcissement d'`otpk_update_consume` (WITH CHECK `is_used = true`) a cassé
-- le `publishKeys` du client (upsert INSERT ... ON CONFLICT DO UPDATE qui remet
-- `is_used = false` sur les prekeys de l'utilisateur) → HTTP 403.
--
-- On rétablit un droit de gestion par le propriétaire, sans réouvrir la
-- consommation abusive : autrui ne peut que passer is_used false -> true
-- (otpk_update_consume), le propriétaire peut gérer ses propres lignes.
-- ============================================================================

DROP POLICY IF EXISTS "otpk_update_own" ON public.one_time_prekeys;
CREATE POLICY "otpk_update_own"
  ON public.one_time_prekeys FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
