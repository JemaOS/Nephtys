-- ============================================================================
-- Retrait des colonnes de présence GLOBALEMENT lisibles de public.profiles
-- ============================================================================
-- `profiles` est lisible par tout compte authentifié (policy USING(true)).
-- `last_seen` y est peuplé (8/8) → n'importe quel compte lisait l'historique
-- « vu pour la dernière fois » de tous les utilisateurs.
--
-- La présence fonctionnelle est gérée 100% via le canal Supabase Realtime
-- `online-users` (cf. src/hooks/usePresence.ts). Ces colonnes DB n'étaient ni
-- lues (hors un repli supprimé) ni écrites par le client, ni par un trigger,
-- ni par une edge function. On les retire donc.
-- ============================================================================

-- `view_active_chats` (créée hors migrations, NON utilisée par le client)
-- expose aussi p.is_online des participants via REST → on la supprime.
DROP VIEW IF EXISTS public.view_active_chats;

ALTER TABLE public.profiles
    DROP COLUMN IF EXISTS is_online,
    DROP COLUMN IF EXISTS last_seen;
