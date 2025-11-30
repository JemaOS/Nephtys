# Content Structure Plan - Anu (Clone WhatsApp P2P Sécurisé)

## 1. Material Inventory

**Documents de recherche :**
- `docs/anu_research/architecture_anu_hybride.md` (6 420 mots, architecture P2P hybride + cloud chiffré)
- `docs/anu_research/protocoles_p2p_messagerie.md` (5 890 mots, WebRTC/libp2p/Matrix/Signal Protocol)
- `docs/anu_research/authentification_anonyme.md` (5 240 mots, Passkeys/WebAuthn/wallet-based auth)
- `docs/anu_research/solutions_stockage_sync.md` (6 780 mots, IPFS/Arweave/Supabase/Firebase)
- `docs/anu_research/privacy_log_strategies.md` (5 310 mots, NO-LOG Session/Signal/Wire)

**Visuels :**
Aucun asset graphique fourni (logos, screenshots, illustrations à créer lors de l'implémentation)

**Données :**
Architecture technique et protocoles documentés (P2P, E2EE, sync multi-appareils)

**Charts :**
Aucun chart disponible (métriques de performance à visualiser lors de l'implémentation)

## 2. Website Structure

**Type :** Application mobile-first (SPA mobile)

**Raisonnement :** Anu est une application de messagerie instantanée moderne, nécessitant une navigation fluide entre écrans avec état persistant, animations de transitions et expérience temps réel. L'architecture SPA mobile convient parfaitement avec navigation par stack/tabs.

## 3. Écrans et Sections

### Écran 1: Onboarding & Authentification (`/auth`)

**Objectif :** Premier contact, inscription/connexion sécurisée sans numéro de téléphone

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Hero Onboarding | Full-screen slides (3 slides) | `authentification_anonyme.md` L5-15 | Valeurs principales : Privacy-first, P2P sécurisé, NO-LOG | - |
| Formulaire Auth | Auth Form Pattern | `authentification_anonyme.md` L40-45, L66-72 | Options : Email/pseudo + Passkeys (WebAuthn), wallet-based (optionnel) | - |
| Indicateurs Sécurité | Trust Badges | `architecture_anu_hybride.md` L11-17 | E2EE par défaut, Anonymisation métadonnées, Chiffrement côté client | - |
| Footer légal | Links minimal | `privacy_log_strategies.md` L149-155 | Politique confidentialité, Conditions, RGPD/EDPB compliance | - |

**Notes :** Pas d'exigence de numéro de téléphone (architecture privacy-first). Focus sur Passkeys comme méthode principale (résistance phishing), option wallet-based pour audiences crypto.

---

### Écran 2: Liste Conversations (`/chats`)

**Objectif :** Hub principal, accès rapide aux conversations actives

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Header App | App Header avec recherche | `protocoles_p2p_messagerie.md` L23-26 | Logo Anu + Search bar + Avatar utilisateur | Logo Anu (à créer) |
| Liste Conversations | Conversation Card List | Données temps réel (P2P/cloud sync) | Nom contact, dernier message (tronqué), timestamp, statut E2EE, non-lus | Avatars contacts |
| Floating Action Button | FAB Pattern | - | Action : Nouvelle conversation | - |
| Bottom Navigation | Tab Bar (4 tabs) | - | Chats, Statuts, Contacts, Paramètres | Icons SVG |
| Statut Sync | Status Indicator | `solutions_stockage_sync.md` L95-99 | Indicateur P2P connecté / Cloud sync / Offline | - |

**Notes :** Chaque conversation affiche badge E2EE (cadenas vert néon), indicateur de livraison P2P vs cloud. Ordre chronologique inversé (plus récent en haut).

---

### Écran 3: Conversation Active (`/chats/:id`)

**Objectif :** Échange de messages temps réel avec contact ou groupe

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Header Conversation | Conversation Header | Métadonnées contact/groupe | Nom, avatar, statut (en ligne/hors ligne/en train d'écrire), indicateur E2EE | Avatar contact |
| Zone Messages | Message Bubbles (left/right) | Messages chiffrés E2E | Contenu texte, timestamp, statut livraison (envoyé/livré/lu), émetteur | - |
| Zone Saisie | Input Bar avec actions | - | Champ texte, boutons : fichiers, emoji, vocal, envoi | Icons SVG |
| Indicateur Chiffrement | Security Badge | `architecture_anu_hybride.md` L44-46 | "Chiffré de bout en bout" + protocole (Signal/MLS) | Icône cadenas |
| Actions Avancées | Swipe Actions / Menu | `privacy_log_strategies.md` L106-114 | Épingler, archiver, supprimer conversation, paramètres de rétention | - |

**Notes :** Messages émis = alignés à droite (fond violet glassmorphism), messages reçus = alignés à gauche (fond blanc translucide). Timestamps relatifs ("il y a 2min", "Hier 14:32").

---

### Écran 4: Partage de Fichiers (Modal / Drawer)

**Objectif :** Envoi de photos, vidéos, documents avec chiffrement

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Sélecteur Média | Media Picker Grid | Galerie locale appareil | Photos/vidéos récentes (thumbnails) | Thumbnails photos |
| Upload Progress | Progress Indicator | `solutions_stockage_sync.md` L98-105 | Chiffrement côté client → Upload P2P/cloud → Confirmation | - |
| Options Partage | Toggle Options | - | Compression qualité, durée de vie (24h, 7j, permanent), sync cloud | - |
| Type de Fichiers | File Type Selector | - | Photos, Vidéos, Documents, Audio, Contacts | Icons types |

**Notes :** Tous les fichiers chiffrés côté client avant upload (AES-256-GCM). Indicateur taille fichier et temps estimé d'envoi selon connexion (P2P direct vs relayed TURN).

---

### Écran 5: Appels Audio/Vidéo (`/call/:id`)

**Objectif :** Communication temps réel avec indicateurs de sécurité

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Vue Appel Vidéo | Full-screen Video Containers | Stream WebRTC | Vidéo contact (grand) + vidéo locale (PiP en coin) | Stream vidéo |
| Indicateurs Connexion | Connection Quality Indicator | `protocoles_p2p_messagerie.md` L106-112 | Type connexion (P2P direct / TURN relay), latence, qualité (HD/SD) | - |
| Indicateur E2EE | Encryption Badge | `architecture_anu_hybride.md` L44-46 | "Appel chiffré de bout en bout" + empreinte DTLS-SRTP | Cadenas animé |
| Contrôles Appel | Call Control Bar | - | Mute audio, arrêt vidéo, haut-parleur, raccrocher | Icons SVG |
| Statistiques Réseau | Stats Overlay (optionnel) | `protocoles_p2p_messagerie.md` L221-229 | RTT, packet loss, jitter, bitrate, codec (Opus/VP8) | - |

**Notes :** Priorité P2P direct (<300ms latency), fallback TURN si NAT restrictif. Codec adaptatif selon bande passante. Affichage empreinte de sécurité (fingerprint) pour vérification manuelle.

---

### Écran 6: Contacts (`/contacts`)

**Objectif :** Gestion annuaire avec privacy-first (pas de sync auto)

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Search Bar | Search Input | - | Recherche par nom, pseudo, Session ID | - |
| Liste Contacts | Contact Card List | `authentification_anonyme.md` L99-108 | Nom, pseudo, statut (en ligne/hors ligne), clé publique (tronquée) | Avatars |
| Actions Contact | Swipe Actions | - | Démarrer chat, appel audio, appel vidéo, voir profil | Icons SVG |
| Ajout Contact | FAB + Modal | `privacy_log_strategies.md` L48-51 | Méthodes : QR code, Session ID, email/pseudo, découverte Passkeys hachée | - |
| Groupes Contacts | Section Separators | - | Favoris, En ligne, Tous les contacts | - |

**Notes :** Pas de synchronisation automatique avec carnet téléphone (privacy). Découverte opt-in avec hachage côté client (Signal-like). Option d'ajout par QR code en personne.

---

### Écran 7: Groupes (`/groups/:id`)

**Objectif :** Conversations de groupe avec permissions admin

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Header Groupe | Group Header | Métadonnées groupe | Nom groupe, nombre membres, photo groupe | Photo groupe |
| Zone Messages | Group Message Bubbles | Messages chiffrés MLS | Messages avec nom émetteur, avatar, timestamp | Avatars membres |
| Liste Membres | Members List (drawer/modal) | Membres du groupe | Nom, statut, rôle (admin/membre), actions (retirer si admin) | Avatars |
| Paramètres Groupe | Settings Panel | - | Nom, description, photo, permissions (qui peut ajouter, envoyer médias), quitter | - |
| Indicateur MLS | MLS Badge | `architecture_anu_hybride.md` L199-216 | "Groupe chiffré MLS" + epoch actuel, membres actifs | - |

**Notes :** Chiffrement de groupe via MLS (Messaging Layer Security) pour scalabilité. Admins peuvent gérer membres et permissions. Rotation d'epoch transparente lors d'ajout/retrait membre.

---

### Écran 8: Statuts / Stories (`/status`)

**Objectif :** Partage éphémère 24h (type Instagram Stories)

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Mon Statut | Status Ring (large) | Statut utilisateur actuel | Photo/vidéo/texte actuel + durée restante (countdown 24h) | Média statut |
| Statuts Contacts | Horizontal Scroll Ring List | Statuts contacts non-vus | Avatar avec anneau violet, nom contact | Avatars |
| Visionneuse Statut | Full-screen Viewer | Contenu statut | Média plein écran + progress bars (multi-statuts), views counter | Média HD |
| Création Statut | Creator Modal | - | Capture photo/vidéo, texte sur fond uni, dessins, stickers | - |
| Privacy Statuts | Privacy Settings | `privacy_log_strategies.md` L126-132 | Qui peut voir : Tous, Contacts uniquement, Contacts sauf..., Seulement... | - |

**Notes :** Statuts chiffrés E2E, auto-suppression après 24h (client + serveur). Vues anonymisées si paramètre activé. Pas de screenshots natifs (protection).

---

### Écran 9: Paramètres (`/settings`)

**Objectif :** Configuration privacy, sécurité, compte, sync

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Profil Utilisateur | Profile Card | Données utilisateur | Nom, pseudo, Session ID, photo, bio | Avatar utilisateur |
| Privacy & Sécurité | Settings Section | `privacy_log_strategies.md` L90-115 | Sealed sender, découverte contacts, appareils vérifiés, verrous bio/PIN | - |
| Synchronisation | Sync Settings Section | `solutions_stockage_sync.md` L95-107 | Type sync (P2P + Cloud, P2P only, Cloud only), fréquence, backup chiffré | - |
| Multi-Appareils | Devices List | Appareils connectés | Liste appareils (nom, type, dernière activité), révocation distance | Icons devices |
| Notifications | Notifications Settings | - | Push (APN/FCM sans contenu), in-app, sons, vibrations | - |
| Compte & Données | Account Section | - | Export données, supprimer compte, portabilité RGPD | - |
| À propos | About Section | - | Version app, licences open source, politique confidentialité, support | - |

**Notes :** Section "Appareils vérifiés" avec empreintes de clés publiques pour vérification manuelle (prévention MITM). Export données en JSON chiffré.

---

### Écran 10: Sync Settings (Avancé) (`/settings/sync`)

**Objectif :** Contrôle granulaire backup et synchronisation

**Mappage de contenu :**

| Section | Pattern Composant | Source Données | Contenu à Utiliser | Visual Asset |
|---------|-------------------|----------------|-------------------|--------------|
| Mode Sync | Radio Group | `solutions_stockage_sync.md` L39-53 | P2P Hybride (recommandé), P2P Only, Cloud Chiffré Only, Local Only | - |
| Granularité Backup | Toggle List | - | Messages, Médias, Contacts, Paramètres, Clés (exclues par défaut) | - |
| Cloud Provider | Provider Selector | `solutions_stockage_sync.md` L95-99 | Supabase (recommandé), IPFS + Pinning, Arweave (archivage), Self-hosted | Icons providers |
| Chiffrement | Encryption Settings | `solutions_stockage_sync.md` L154-161 | Algorithme (AES-256-GCM fixe), gestion clés (locale uniquement), rotation | - |
| Rétention & Purge | Retention Settings | `privacy_log_strategies.md` L179-186 | Durée conservation messages (7j/30j/90j/illimité), auto-purge médias | - |
| Réseau P2P | P2P Network Settings | `protocoles_p2p_messagerie.md` L51-59 | Protocole (libp2p GossipSub), NAT traversal (STUN/TURN), relays | - |

**Notes :** Avertissements clairs sur les choix (P2P Only = pas de backup cloud, risque perte si tous appareils perdus). Chiffrement côté client non désactivable (protection par design).

---

## 4. Analyse de Contenu

**Densité d'Information :** Moyenne-Élevée
- Documentation technique détaillée (29 640 mots au total)
- Architecture P2P hybride complexe avec multiples protocoles
- 10 fonctionnalités majeures à représenter visuellement
- Focus fort sur privacy/sécurité nécessitant indicateurs visuels clairs

**Balance de Contenu :**
- **Texte** : ~60% (descriptions, paramètres, statuts messages)
- **UI Interactive** : ~30% (formulaires, toggles, listes, navigation)
- **Visuels** : ~10% (avatars, médias partagés, photos statuts)
- **Données temps réel** : Flux continu (messages, statuts connexion, indicateurs E2EE)

**Type de Contenu :** Application interactive temps réel
- Heavy UX/UI (messagerie instantanée)
- Privacy-first avec nombreux indicateurs de sécurité
- Multi-modal (texte, audio, vidéo, fichiers, statuts)
- Architecture technique sophistiquée masquée sous UX simple

**Notes spéciales :**
- Pas d'assets visuels fournis = design system créera guidelines pour logos, icons, illustrations
- Indicateurs de sécurité omniprésents (E2EE badges, encryption status, P2P connection quality)
- Glassmorphism nécessite attention particulière aux contrastes (accessibility WCAG AA minimum)
- Animations fluides essentielles pour perception de qualité (400-600ms, ease-out)
