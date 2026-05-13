-- ============================================================================
-- Cache des Open Graph previews
-- ============================================================================
-- Sert à éviter de re-fetch les mêmes URLs en boucle. L'edge function
-- `link-preview` lit/écrit ici via le service-role.
-- TTL applicatif (7 jours) géré dans la fonction edge ; on peut purger
-- manuellement via une tâche cron ou un trigger plus tard si besoin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.link_preview_cache (
    url           TEXT PRIMARY KEY,
    title         TEXT,
    description   TEXT,
    image         TEXT,
    site_name     TEXT,
    domain        TEXT NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_link_preview_cache_fetched_at
    ON public.link_preview_cache (fetched_at DESC);

-- Pas d'accès anon/authenticated direct : seul le service-role
-- (utilisé par l'edge function) doit pouvoir lire/écrire.
ALTER TABLE public.link_preview_cache ENABLE ROW LEVEL SECURITY;

-- Aucune policy => personne sauf service-role n'y accède.
REVOKE ALL ON public.link_preview_cache FROM PUBLIC;
REVOKE ALL ON public.link_preview_cache FROM anon;
REVOKE ALL ON public.link_preview_cache FROM authenticated;
