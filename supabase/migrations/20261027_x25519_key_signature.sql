-- ============================================================================
-- 2026-10-27 — Authentification de la clé publique X25519 (anti-MITM)
-- ============================================================================
-- La clé publique X25519 « utilisateur » (profiles.x25519_public_key) protège
-- le chiffrement du texte/média mais n'était PAS authentifiée : un serveur
-- malveillant pouvait substituer la clé du destinataire et lire le trafic.
--
-- On publie désormais une signature Ed25519 de cette clé, ainsi que la clé
-- publique de signature (dérivée de la phrase de récupération, label
-- « signing »). Le client VÉRIFIE la signature avant d'envelopper une clé.
--
-- Rétrocompatible : les clés historiques sans signature restent utilisables
-- en TOFU (confiance à la première utilisation) avec détection de changement.
-- ============================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS x25519_public_key_sig text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS x25519_signing_key text;