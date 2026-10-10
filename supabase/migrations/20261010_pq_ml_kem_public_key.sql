-- ============================================================================
-- Post-quantique (ML-KEM-768) — clé publique pour l'échange hybride X3DH
-- ============================================================================
-- Ajoute la clé publique ML-KEM publiée par l'utilisateur. Utilisée par
-- l'initiateur X3DH pour encapsuler un secret supplémentaire (hybride X25519 +
-- ML-KEM). NULL pour les comptes pré-PQ → repli sur le chemin classique
-- (rétro-compatibilité totale).
-- ============================================================================

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS ml_kem_public_key text;

COMMENT ON COLUMN public.profiles.ml_kem_public_key IS
    'Clé publique ML-KEM-768 (post-quantique) pour l''échange de clés hybride X3DH.';
