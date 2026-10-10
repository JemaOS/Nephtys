-- ============================================================================
-- Suppression de policies `TO public USING(true)` redondantes et fuyantes
-- ============================================================================
--  • profiles_read : doublait les policies `authenticated` et exposait les
--    colonnes de clés privées au rôle anon (vecteur de la fuite corrigée par
--    20261010_revoke_anon_profiles_select).
--  • statuses.view_all_statuses : laissait tout compte lire TOUS les statuts,
--    y compris privés, court-circuitant statuses_select_visible.
--
-- Les policies `authenticated`/owner-scoped restent en place → aucune
-- fonctionnalité connectée n'est perdue. Vérifié : statuses_select_visible
-- (owner + contacts non privés) et profiles_select_authenticated subsistent.
-- ============================================================================

DROP POLICY IF EXISTS "profiles_read" ON public.profiles;
DROP POLICY IF EXISTS "view_all_statuses" ON public.statuses;
