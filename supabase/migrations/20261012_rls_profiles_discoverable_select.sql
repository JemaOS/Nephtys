-- ============================================================================
-- 20261012 — profiles SELECT : respecter `discoverable` (anti-énumération)
-- ============================================================================
-- Avant : policy `profiles_select_authenticated` (20261010_rls_hardening.sql:41-44)
-- USING (true) → tout compte authentifié peut lire TOUTES les lignes de
-- `profiles` (annuaire énumérable : username, bio, avatar, clés publiques...).
-- L'indicateur `discoverable` (20261010_profiles_discoverable.sql) n'était
-- jamais appliqué côté RLS (seulement un index de recherche).
--
-- Après : lecture d'une ligne autorisée si
--   • c'est SON propre profil                         (id = auth.uid()),
--   • le profil est découvrable                       (discoverable = true),
--   • elle partage une CONVERSATION avec la ligne     (membre commun),
--   • la ligne est un CONTACT (relation `public.contacts`).
--
-- Les colonnes de clés privées ont été déplacées vers
-- `public.user_key_material` (20261010_user_key_material_table.sql) : plus de
-- fuite de matériel privé ici.
--
-- Vérifié : les listes de conversations passent par `get_user_conversations`
-- (SECURITY INVOKER, filtré) et ne lisent que des profils de membres de SES
-- conversations → couverts par la clause « conversation partagée ».
-- ============================================================================

-- 1) Retirer les policies SELECT existantes sur profiles
DO $mig$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename  = 'profiles'
          AND cmd = 'SELECT'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', r.policyname);
    END LOOP;
END
$mig$;

-- 2) Policy SELECT resserrée
DROP POLICY IF EXISTS "profiles_select_discoverable_or_related" ON public.profiles;
CREATE POLICY "profiles_select_discoverable_or_related"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (
        id = auth.uid()
        OR discoverable
        OR EXISTS (
            SELECT 1
            FROM public.conversation_members cm_self
            JOIN public.conversation_members cm_other
              ON cm_self.conversation_id = cm_other.conversation_id
            WHERE cm_self.user_id = auth.uid()
              AND cm_other.user_id = profiles.id
        )
        OR EXISTS (
            SELECT 1
            FROM public.contacts c
            WHERE (c.user_id = auth.uid() AND c.contact_user_id = profiles.id)
               OR (c.user_id = profiles.id AND c.contact_user_id = auth.uid())
        )
    );
