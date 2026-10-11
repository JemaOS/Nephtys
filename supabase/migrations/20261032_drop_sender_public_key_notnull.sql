-- ============================================================================
-- 2026-10-32 — Sealed sender : ne plus stocker la clé publique de l'expéditeur
-- ============================================================================
-- Le « sealed sender » était défait par la colonne `sender_public_key` des
-- tables de clés de message : chaque (message, destinataire) stockait la clé
-- publique X25519 STABLE de l'expéditeur. Le serveur n'avait qu'à joindre
-- `profiles.x25519_public_key` pour retrouver QUI a écrit à qui.
--
-- Nouveau modèle : la clé publique d'identité de l'expéditeur n'est PLUS
-- stockée en clair. Elle est transportée DANS le payload sealed sender v3
-- (chiffré de bout en bout au destinataire, authentifié par la signature
-- Ed25519 de l'expéditeur), ou, à défaut, dérivée côté destinataire depuis
-- `profiles` APRÈS vérification du scellé (cf. src/lib/messaging/sealedSender.ts
-- et src/lib/textEncryption.ts).
--
-- Cette migration rend donc `sender_public_key` OPTIONNELLE (nullable) sur les
-- deux tables. Rétrocompatible : les anciennes lignes (NOT NULL respectée avant)
-- gardent leur valeur et restent déchiffrables ; les nouvelles lignes l'omettent.
--
-- ⚠️ Aucune donnée existante n'est supprimée ici. Les valeurs historiques de
-- `sender_public_key` restent en base : la purge/rotation est une étape
-- ultérieure (elle casserait le déchiffrement des messages anciens encore
-- couverts par le repli colonne).
-- ============================================================================

-- 1) Clés de texte : la clé publique de l'expéditeur devient optionnelle.
ALTER TABLE public.message_text_keys
    ALTER COLUMN sender_public_key DROP NOT NULL;

COMMENT ON COLUMN public.message_text_keys.sender_public_key IS
    'Clé publique X25519 de l''expéditeur. NULL pour le nouveau trafic : la clé '
    'est transportée dans le payload sealed sender v3 (ou dérivée de profiles '
    'après vérification). Valeur conservée pour les messages historiques.';

-- 2) Clés de média : idem.
ALTER TABLE public.message_media_keys
    ALTER COLUMN sender_public_key DROP NOT NULL;

COMMENT ON COLUMN public.message_media_keys.sender_public_key IS
    'Clé publique X25519 de l''expéditeur. NULL pour le nouveau trafic : la clé '
    'est transportée dans le payload sealed sender v3 (ou dérivée de profiles '
    'après vérification). Valeur conservée pour les messages historiques.';
