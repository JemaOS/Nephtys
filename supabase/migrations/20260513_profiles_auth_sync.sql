-- ====================================================================
-- Sync profiles ↔ auth.users
-- ====================================================================
-- Problème :
--   • Quand on supprime une ligne dans `public.profiles` (depuis le dashboard
--     ou en SQL), l'utilisateur correspondant dans `auth.users` reste.
--   • L'edge function `auth-with-username` créant les users avec un email
--     synthétique `<pseudo>@nephtys.internal`, le pseudo devient impossible
--     à réutiliser tant que l'auth user existe encore.
--
-- Solution :
--   1. Nettoyer les orphelins existants (profile sans auth user et inverse)
--   2. Ajouter une FK profiles.id → auth.users.id ON DELETE CASCADE
--      (suppression de l'auth user → cascade vers profile)
--   3. Ajouter un trigger AFTER DELETE sur profiles pour supprimer
--      automatiquement l'auth user correspondant (cas d'admin qui supprime
--      uniquement la ligne profiles).
-- ====================================================================

-- 1) Nettoyer les orphelins ─────────────────────────────────────────

-- 1a. Profiles sans auth user (probablement résiduels)
DELETE FROM public.profiles p
WHERE NOT EXISTS (
    SELECT 1 FROM auth.users u WHERE u.id = p.id
);

-- 1b. Auth users @nephtys.internal sans profile (= ce qui te bloque actuellement)
-- On utilise l'API auth admin via la fonction interne
DELETE FROM auth.users u
WHERE u.email LIKE '%@nephtys.internal'
  AND NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = u.id
  );

-- 2) Ajouter la FK avec CASCADE ─────────────────────────────────────

-- Drop la contrainte si elle existe déjà sous un autre nom (idempotent)
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE public.profiles DROP CONSTRAINT ' || quote_ident(constraint_name);
    END IF;
END $$;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_id_fkey
    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 3) Trigger inverse : DELETE profile → DELETE auth user ────────────

CREATE OR REPLACE FUNCTION public.delete_auth_user_on_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Supprime l'auth user. Le ON DELETE CASCADE de la FK ne re-trigger
    -- pas ce trigger car la ligne profile est déjà partie.
    DELETE FROM auth.users WHERE id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_delete_auth_user_on_profile_delete ON public.profiles;
CREATE TRIGGER trg_delete_auth_user_on_profile_delete
    AFTER DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.delete_auth_user_on_profile_delete();

-- Verrouiller l'accès à la fonction (trigger uniquement)
REVOKE ALL ON FUNCTION public.delete_auth_user_on_profile_delete() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.delete_auth_user_on_profile_delete IS
    'Trigger : supprime auth.users.id quand la ligne profiles est supprimée. Permet la réutilisation des pseudos.';
