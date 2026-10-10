-- ====================================================================
-- Discrétion dans l'annuaire (non destructif)
-- ====================================================================
-- Ajoute un indicateur `discoverable` par profil. Défaut = true → AUCUN
-- changement de comportement pour l'existant.
--
-- Si false : le pseudo n'est plus trouvable via la recherche par pseudo
-- (annuaire). Les contacts et conversations DÉJÀ établis continuent de
-- fonctionner normalement (la lecture par id n'est pas filtrée).
--
-- Objectif : réduire l'exposition de l'annuaire sans casser l'UX ni
-- supprimer de fonctionnalité (option « non destructif »).
-- ====================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS discoverable boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.discoverable IS
    'false = le pseudo n''est pas trouvable dans l''annuaire (recherche par pseudo). Défaut true.';

CREATE INDEX IF NOT EXISTS idx_profiles_discoverable
    ON public.profiles (username) WHERE discoverable = true;
