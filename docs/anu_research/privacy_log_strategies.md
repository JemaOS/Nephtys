# Apps NO-LOG avec synchronisation : équilibrer confidentialité et fonctionnalités — Analyse 2025 de Session, Signal et Wire

## 1. Résumé exécutif

À l’horizon 2025, l’enjeu n’est plus seulement de chiffrer le contenu des messages. Dans les messageries sécurisées, la battledéfensive se joue désormais sur le terrain des métadonnées: qui communique avec qui, quand, à quelle fréquence, et à travers quels appareils. La philosophie “NO-LOG” — définie ici comme l’absence de journalisation côté service du contenu et des interactions au-delà du strict nécessaire opérationnel — doit composer avec des exigences de synchronisation multi‑appareils, d’abonnement à des services payants et de conformité réglementaire. Ce rapport propose un plan directeur opérationnel pour équilibrer confidentialité et fonctionnalités, à partir d’une analyse technique et de politiques de trois architectures de référence: Session, Signal et Wire.

Premièrement, Session adopte un modèle décentralisé orienté “privacy by architecture”: identifiants pseudonymes (Session ID), routage en oignon via un réseau de nœuds (Oxen Service Node Network), mise en mémoire tampon chiffrée distribuée (swarms) pour les destinataires hors ligne, et suppression de l’inscription par numéro de téléphone ou e‑mail. Les paiements Pro s’intègrent au mécanisme de vérification d’abonnement via des preuves cryptographiques insérées dans les messages, validées localement, sans lier identité ni moyen de paiement au statut Pro. L’objectif est explicite: envoyer des messages, pas des métadonnées[^10][^11][^12][^13].

Deuxièmement, Signal combine le chiffrement de bout en bout (E2EE) par défaut avec une minimisation des métadonnées côté service. Sa fonctionnalité Sealed Sender masque l’identité de l’expéditeur au moment de l’envoi, tout en luttant contre l’usurpation via des certificats d’expéditeur de courte durée et des jetons de livraison liés aux clés de profil. La découverte de contacts s’appuie sur du hachage côté client, et l’essentiel de l’historique réside sur l’appareil而非 sur les serveurs. La politique précise toutefois que des éléments techniques minimaux (jetons d’authentification, clés, jetons push) sont conservés pour assurer l’acheminement, et que des données peuvent être transférées vers des pays tiers (dont les États‑Unis) via des prestataires[^1][^2][^3][^4].

Troisièmement, Wire implémente l’E2EE par défaut pour messages, appels et fichiers, avec une trajectoire technologique incluant le standard Messaging Layer Security (MLS) pour l’évolutivité et la sécurité de groupe. Les aspects de sécurité et de confidentialité sont documentés dans des livrets officiels, avec des audits indépendants réguliers et un positionnement d’hébergement européen. L’accent est mis sur la minimisation des données nécessaires au fonctionnement et à la synchronisation multi‑appareils, sans vente de données d’usage. Les notifications push s’appuient sur APN/FCM sans contenu de message, avec alternative websockets/F‑Droid pour contourner FCM[^6][^7][^8][^9][^22].

Conclusion stratégique. Un NO‑LOG effectif est possible sans sacrifier la synchronisation, à condition d’adopter des techniques de dissimulation et de minimisation des métadonnées, de privilégier les validations locales, et de mettre l’utilisateur au centre du contrôle de ses données. Les arbitrages sont connus: la réception “sealed” hors contacts accroît le risque d’abus; la connexion multi‑appareils exige des métadonnées de routage; les notifications push utilisent des jetons techniques. Les priorités 2025: réduire l’exposition IP dans les appels, standardiser la suppression et la portabilité côté entreprise, renforcer la transparence des transferts transfrontaliers, et intégrer les lignes directrices sur l’articulation entre le règlement sur les marchés numériques (DMA), le règlement général sur la protection des données (RGPD) et le règlement sur les services numériques (DSA)[^2][^8][^11][^17][^18][^19].

Ce plan directeur propose un cadre d’architecture, des pratiques d’ingénierie et une feuille de route de conformité pour concevoir et opérer des messageries NO‑LOG robustes, évolutives et compatibles avec les attentes réglementaires et des marchés professionnels.

---

## 2. Cadre de référence et définitions

Par “NO‑LOG”, nous entendons l’absence de journalisation côté service du contenu des communications et des métadonnées sensibles au‑delà du strict nécessaire pour assurer la livraison, la synchronisation et la sécurité opérationnelle. Cette définition inclut la non‑persistance de graphes de contact, d’horodatages de connexion, ou d’identifiants stables permettant la création de traces comportementales. En pratique, un “NO‑LOG” strict est difficile à atteindre dans un modèle centralisé; on vise donc un “journalisation minimale” documentée, bornée par des finalités explicites et des durées de conservation courtes.

Les métadonnées涵盖 les éléments qui ne sont pas le contenu d’un message, mais qui décrivent ou accompagnent la communication: adresses IP, identifiants de compte, clés publiques, timestamps, statut de livraison/lecture, graphes de contact, tokens push, certificats d’expéditeur, et informations de routage. Elles sont critiques parce qu’elles révèlent qui communique avec qui, quand et comment, permettent la corrélation temporelle, et peuvent mener à la désanonymisation par recoupement. Même avec E2EE, l’exposition des métadonnées au service ou à des intermédiaires peut permettre la surveillance, le profilage, ou la contrainte juridique sur des “traces” techniques.

Dans une architecture “privacy by design” (confidentialité dès la conception), la privacy by architecture constitue un levier puissant: minimiser ce qui est créé, où cela transite, et combien de temps c’est retenu. Les technologies d’amélioration de la confidentialité (Privacy‑Enhancing Technologies, PETs) — hachage, preuves à divulgation nulle de connaissance, routage en oignon, E2EE, synchronisation par messages de configuration chiffrés — réduisent la surface de collecte et l’utilité des métadonnées, sans bloquer les usages[^18].

La synchronisation dans ce contexte signifie la propagation cohérente et sécurisée de l’état chiffré et des artefacts techniques nécessaires au fonctionnement multi‑appareils (messages, clés, profils), tout en conservant le contenu hors de portée du service. Elle s’opère via des files d’attente chiffrées, des messages de configuration, des caches de validation locale et des canaux spécialisés (websockets) pour limiter la dépendance à des infrastructures tierces susceptibles d’introduire des métadonnées.

### 2.1 Méthodologie et périmètre

Ce rapport s’appuie sur les politiques officielles et documents techniques des plateformes (Signal, Wire, Session), complétés par des analyses indépendantes et des guides d’organisations reconnues dans le domaine de la vie privée. Les sources incluent la page légale de Signal, son billet sur Sealed Sender, sa documentation de découverte de contacts et de profils; les livrets sécurité et confidentialité de Wire, ainsi que sa page “Security & Privacy”; la documentation et le blog Session, le whitepaper et une analyse technique Nym. Nous faisons référence aux tendances 2025 de la protection des données, aux technologies PETs et aux lignes directrices de l’EDPB sur l’interaction DMA/RGPD/DSA. Les limites majeures tiennent à l’absence de politiques 2025 détaillées côté Session et à la non‑disponibilité de certaines pages EDPB (403), ce qui requiert une validation croisée[^1][^2][^3][^4][^6][^7][^8][^9][^10][^11][^12][^13][^17][^18][^19][^20][^22].

---

## 3. Cartographie des architectures et politiques NO‑LOG

La conception NO‑LOG s’enracine dans l’architecture technique et la politique de confidentialité. Session, Signal et Wire tracent trois voie distinctes.

Session est explicitement conçue pour minimiser les métadonnées en supprimant les identifiants personnels lors de l’inscription et en routant les messages via un réseau en oignon (oxen service nodes). Les messages pour destinataires hors ligne sont stockés temporairement dans des swarms; aucun nœud ne connaît à la fois l’expéditeur et le destinataire. L’inscription s’opère par un identifiant pseudonyme (Session ID). Cette architecture supprime les bases centrales de journalisation du graphe social et réduit la valeur des métadonnées pour un observateur externe[^10][^11][^12][^13].

Signal repose sur un service centralisé minimaliste, avec E2EE par défaut et conservation de l’historique sur l’appareil. Les messages en attente pour appareils hors ligne sont mis en file côté service, avec des informations techniques minimales (jetons, clés) pour le routage et la prévention des abus. Sealed Sender cache l’identité de l’expéditeur au service au moment de l’envoi, au moyen d’enveloppes chiffrées, de certificats et de jetons de livraison liés aux clés de profil. La découverte de contacts utilise du hachage côté client, et les profils sont chiffrés de bout en bout[^1][^2][^3][^4].

Wire opère dans une logique “entreprise‑grade” avec E2EE par défaut et une roadmap MLS pour les groupes à grande échelle. Les audits indépendants, la conformité ISO 27001/27701, et l’hébergement européen soutiennent un positionnement de confiance. Les notifications push évitent l’envoi de contenu via APN/FCM; un mode F‑Droid avec websockets limite la dépendance FCM. Les données conservées sont celles nécessaires au fonctionnement et à la synchronisation, sans vente de données d’usage[^6][^7][^8][^9][^22].

Pour illustrer les convergences et divergences, le tableau comparatif ci‑dessous synthétise les points structurants.

Tableau 1 — Session vs Signal vs Wire: architecture, NO‑LOG et métadonnées

| Axe | Session | Signal | Wire |
|---|---|---|---|
| Architecture | Décentralisée: oxen service nodes, routage en oignon, swarms pour buffer distribué[^10][^11][^12][^13] | Service central minimal; files d’attente pour appareils hors ligne; E2EE par défaut[^1][^2] | E2EE par défaut; MLS en roadmap; hébergement UE; audits indépendants[^6][^7][^8][^22] |
| Identifiants d’inscription | Session ID (pseudonyme), pas de téléphone/email[^10][^11] | Numéro de téléphone requis[^1] | Compte standard, pas d’exigence de numéro publique dans les sources analysées[^6][^9] |
| Découverte de contacts | Non centralisée; pas de graphe social central[^10][^11] | Hachage côté client pour découverte de contacts[^4] | Synchronisation de contacts et conversations; métadonnées minimisées[^6][^8] |
| E2EE | Oui, contenu chiffré de bout en bout[^10][^13] | Oui, messages/appels E2EE[^1] | Oui, par défaut pour messages/appels/fichiers[^6][^7] |
| Stockage des messages | Swarms (buffer distribué éphémère)[^11][^13] | Messages en attente côté service; historique sur l’appareil[^1][^2] | Données nécessaires au fonctionnement/synchronisation; pas de vente de données d’usage[^6][^8] |
| Métadonnées clés | Routage en oignon, pas de graphe central[^11][^13] | Sealed Sender, certificats d’expéditeur, jetons de livraison, profils chiffrés[^2][^3] | Tokens push, vérif. appareils, notifications sécurisées; audits[^6][^8] |
| Contrôle utilisateur | Validation locale des preuves Pro (Session Pro)[^13] | Paramètres de confidentialité; profils et découverte opt‑in[^1][^3][^4] | Vérification d’appareils, ID Shield; paramétrage sécurité[^6][^8] |

Ce panorama révèle que la minimisation des métadonnées peut être obtenue par des voies différentes: architecture décentralisée et routage en oignon (Session) ou enveloppes et certificats chiffrés couplés à une journalisation minimale (Signal). Pour un contexte d’entreprise, Wire offre un cadre d’audit et de conformité robuste, avec un effort explicite sur la transparence des pratiques.

### 3.1 Session — “Send messages, not metadata”

Session supprime l’exigence d’un numéro de téléphone ou d’une adresse e‑mail; l’inscription s’effectue via un Session ID long et pseudonyme, basé sur une paire de clés publique/privée. Les messages suivent des “onion requests” à travers trois nœuds; chaque nœud ne connaît que le saut précédent et suivant. Les swarms mémorisent temporairement les charges utiles chiffrées pour les destinataires hors ligne; la distribution empêche toute vue d’ensemble sur un nœud unique. L’architecture réduit les possibilités de corrélation temporelle ou de reconstruction de graphe social[^10][^11][^12][^13].

La synchronisation du statut Pro repose sur des preuves cryptographiques intégrées au corps des messages. Ces preuves sont validées localement, sans révélation de l’identité ni des moyens de paiement. Le système synchronise le statut via des messages de configuration chiffrés, ce qui limite l’exposition de métadonnées à un moment clé de l’expérience utilisateur[^13].

### 3.2 Signal — minimisation avec service central minimal

Signal garantit l’E2EE pour messages et appels, avec stockage de l’historique sur les appareils. Le service conserve le strict minimum technique: par exemple, jetons d’authentification, clés et jetons push pour le routage, ainsi que des messages mis en file pour la livraison aux appareils temporairement hors ligne. Sealed Sender ajoute une couche de protection des métadonnées en masquant l’identité de l’expéditeur au service: un certificat d’expéditeur de courte durée, des jetons de livraison dérivés des clés de profil, et une enveloppe chiffrée empêchent l’accès aux identifiants au moment de l’envoi. La découverte de contacts s’appuie sur du hachage cryptographique côté client, réduisant l’exposition de l’annuaire; les profils sont chiffrés de bout en bout[^1][^2][^3][^4].

### 3.3 Wire — E2EE par défaut et orientation entreprise

Wire chiffre de bout en bout par défaut pour messages, appels et fichiers. Chaque message use d’une nouvelle clé; les communications de groupe s’appuient sur MLS pour l’évolutivité et la sécurité. Les audits indépendants et certifications ISO 27001/27701, ainsi que l’hébergement en Europe (Allemagne, Irlande), apportent des garanties importantes dans un cadre RGPD. Les notifications push sont conçues pour ne pas contenir de données sensibles (APN/FCM), avec une alternative websockets/F‑Droid. La confidentialité est décrite comme “par conception”: ne vendre aucune donnée d’analyse/usage, et ne conserver que les données nécessaires au fonctionnement et à la synchronisation[^6][^7][^8][^9][^22].

---

## 4. Minimisation des métadonnées: techniques et limites

La réduction des métadonnées s’appuie sur plusieurs techniques complémentaires.

Le routage en oignon et la décentralisation, caractéristiques de Session, isolent la connaissance du chemin complet. Chaque nœud ne voit qu’un tronçon; la mise en tampon dans des swarms évite une file centrale; l’absence d’inscription par identifiant réel rompt le lien entre identité légale et compte. Cette “privacy by architecture” réduit la valeur des métadonnées pour toute partie intéressée par la surveillance de masse[^11][^13].

Les enveloppes chiffrées et la dissimulation de l’expéditeur, au cœur de Sealed Sender (Signal), compliquent le profilage de l’expéditeur côté service: le certificat d’expéditeur et le jeton de livraison sont chiffrés et validés localement par le destinataire. La découverte de contacts par hachage côté client limite l’exposition des annuaires. Les profils chiffrés protègent les informations affichées, tout en permettant l’échange de clés de profil nécessaires aux mécanismes anti‑abus[^2][^4].

Les notifications “métadonnées‑minimales” sont un autre levier: Wire utilise APN/FCM sans contenu de message; Session et Signal, selon leur modèle, évitent d’inclure la charge utile dans les notifications et privilégient des canaux directs (websockets, connexions sécurisées) pour l’essentiel de l’acheminement[^6][^8].

Nonetheless, des limites subsistent. La réception “sealed sender” hors contacts打开了 la porte aux abus si l’option est activée sans garde‑fous; la gestion multi‑appareils requiert des métadonnées de routage (identifiants d’appareil, tokens de synchronisation); les mécanismes anti‑abus (rate limiting, détection de spam) sont difficilement compatibles avec un NO‑LOG absolu. L’exposition IP dans les appels P2P reste une zone d’attention, car même si le contenu est chiffré, l’IP révèle des informations de réseau utiles à l’analyse de trafic[^2][^11].

---

## 5. Synchronisation sans journalisation: meilleures pratiques 2025

Un design “NO‑LOG” crédible implique de déplacer les validations et la logique sensible vers l’appareil, de limiter la durée de vie des artefacts techniques, et de documenter la finalité des métadonnées indispensables.

Premièrement, la validation locale des preuves (Session Pro) démontre une approche robuste: les certificats d’abonnement sont insérés dans le corps des messages et vérifiés sur l’appareil, avec cache des résultats et synchronisation via des messages de configuration chiffrés. Cela évite de créer des journaux d’abonnement corrélables et découple identité et paiement[^13].

Deuxièmement, les messages de configuration chiffrés pour synchroniser l’état multi‑appareils réduisent la nécessité de stocker des métadonnées persistantes côté service. Sealed Sender, enmasquant l’expéditeur, limite la collecte de métadonnées d’envoi; la rotation et les expirations de certificats/jetons réduisent la fenêtre d’utilité des métadonnées en cas de collecte accidentelle[^2].

Troisièmement, la file d’attente côté service doit être estrictamente bornée: conservation minimale pour cause, délais courts, finalités explicites, et suppression automatique. Les services de notification doivent éviter la divulgation de contenu et limiter les identifiants à des jetons temporaires. L’usage de websockets et de connexions directes limite la dépendance à des infrastructures tierces susceptibles de générer des métadonnées[^6][^8].

Le tableau suivant propose une checklist opérationnelle à chaque étape du cycle de vie des données.

Tableau 2 — Checklist NO‑LOG par étape

| Étape | Contrôles recommandés | Finalité | Base juridique | Durée de conservation | Responsable | Rétention/Suppression |
|---|---|---|---|---|---|---|
| Inscription | Pseudonymes; éviter téléphone/email; hachage d’identifiants | Création de compte | Consentement explicite | Minimale; liée à la durée d’activité | Produit | Suppression à la demande |
| Découverte de contacts | Hachage côté client; opt‑in explicite | Correspondre aux contacts | Consentement | Jusqu’à révocation | Appareil/Service | Révocation et purge locale |
| Envoi | Enveloppes chiffrées; certificats courts; tokens de livraison | Livrer sans révéler expéditeur | Intérêt légitime minimal | Éphémère; expiration courte | Appareil/Service | Rotation et purge |
| Buffer/Synchronisation | Files chiffrées; messages de config; websockets | Livraison et cohérence multi‑appareils | Exécution du contrat | Très courte; “juste‑à‑temps” | Service | Vidage automatique |
| Notifications | Push sans contenu; tokens temporaires | Alerter sans exposer | Intérêt légitime minimal | Très courte | Appareil/Service | Expirations et rotation |
| Paiement/Preuves | Preuves cryptographiques locales; découplage identité/paiement | Vérifier statut Pro | Consentement | Éphémère; résultat en cache | Appareil | Suppression des caches |
| Appels | Préférer TURN chiffré; minimiser IP | Qualité et sécurité | Intérêt légitime | N/A | Réseau/Appareil | N/A |

Ces pratiques s’alignent avec les principes généraux de minimisation, de limitation du stockage et de privacy by design et by default. Elles forment une base pour l’auditabilité et la conformité, sans révéler le contenu des communications[^8][^18].

### 5.1 Modèle d’architecture de synchronisation “zero‑knowledge”

Un modèle “zero‑knowledge” opère avec des validations locales et des preuves cryptographiques vérifiables, sans créer de liens corrélables entre identité et usage. La rotation régulière de certificats/jetons (expirations courtes, révocations) réduit la valeur d’archives de métadonnées. Les messages de configuration chiffrés transportent l’état nécessaire à la cohérence multi‑appareils sans exposer d’artefacts persistants côté service. Ce modèle, démontré par Session Pro, est transposable aux environnements centralisés via des enveloppes chiffrées et des certificats courts, en complément des mécanismes anti‑abus nécessaires[^2][^13].

---

## 6. Contrôle utilisateur des données

La confiance s’accroît avec un contrôle utilisateur réel et simple. Trois axes sont déterminants: visibilité et maîtrise des paramètres de confidentialité; portabilité/export; suppression et droits (accès, effacement, objection).

Côté Signal, les utilisateurs peuvent ajouter des informations facultatives (nom, photo) chiffrées de bout en bout, gérer leur profil et choisir d’activer des fonctionnalités comme Sealed Sender. La découverte de contacts est opt‑in et utilise du hachage cryptographique, ce qui donne une maîtrise de l’exposition de l’annuaire. La politique insiste sur l’appartenance des données à l’utilisateur et la limitation des informations techniques conservées par le service[^1][^3][^4].

Session, par sa conception, n’exige pas d’identifiants réels; la validation locale des preuves Pro renforce l’idée que l’abonnement n’est pas lié à l’identité. La suppression peut être opérée par la révocation des identifiants (Session ID, clés), tandis que la portabilité nécessite une action côté utilisateur (export des conversations stockées localement)[^10][^13].

Wire offre des fonctions de vérification d’appareils et d’identité des contacts (ID Shield) afin de prévenir les attaques de l’homme du milieu, et documentent des procédures de sécurité. Les données conservées sont celles nécessaires au fonctionnement et à la synchronisation; l’orientation entreprise facilite la gouvernance des comptes, la portabilité et la suppression dans un cadre contractuel, sous réserve d’information claire dans la politique de confidentialité[^6][^8][^9].

Pour objectiver ces différences, le tableau suivant compare les fonctions de contrôle utilisateur.

Tableau 3 — Contrôle utilisateur: Signal vs Session vs Wire

| Fonction | Signal | Session | Wire |
|---|---|---|---|
| Paramètres de confidentialité | Gestion profil E2EE; Sealed Sender configurable[^1][^3][^2] | Paramètres axés sur identités pseudonymes; validation Pro locale[^10][^13] | Vérification d’appareils; ID Shield; sécurité configurable[^6][^8] |
| Découverte de contacts | Hachage côté client; opt‑in[^4] | Pas de découverte centralisée; pas d’annuaire global[^10][^11] | Synchronisation de contacts; métadonnées minimisées[^6][^8] |
| Portabilité | Export local; contenu E2EE non accessible au service[^1] | Export local (stockage client); dépendances limitées | Portabilité dans cadre entreprise; documentation nécessaire[^8][^9] |
| Suppression | Effacement local; comptes liés à numéros[^1] | Révocation d’ID/cles; purge des caches[^10][^13] | Suppression dans cadre contractuel; hébergement UE[^8][^9] |

Dans tous les cas, l’expérience utilisateur doit rendre visibles les implications de chaque choix (par exemple, l’option “recevoir des messages Sealed Sender de non‑contacts”), avec des messages clairs, des risques expliqués, et des voies de recours simples pour l’effacement et la portabilité.

---

## 7. Enjeux réglementaires et de confiance (DMA/RGPD/DSA, transferts)

Les lignes directrices de 2025 sur l’interaction entre le DMA, le RGPD et le DSA clarifient deux impératifs: la conformité au DMA ne doit pas se faire au détriment de la protection des données, et les中介 services doivent articuler leurs obligations de diligence, transparence et droits des utilisateurs avec les exigences de sécurité et de modération. Les opérateurs de messageries NO‑LOG doivent documenter clairement les catégories de données, les durées de conservation, les mécanismes de suppression et les flux transfrontaliers[^17][^19].

La question des transferts internationaux est sensible. La page légale de Signal mentionne le transfert d’informations chiffrées et de métadonnées vers les États‑Unis et d’autres pays via des prestataires (codes de vérification, support). Cette déclaration exige une vigilance renforcée en matière de garanties appropriées, d’information des utilisateurs et de minimisation, notamment pour un service positionné sur la minimisation des métadonnées[^1].

La conformité entreprise implique de publier une politique de confidentialité claire, d’afficher des métriques de réponse aux demandes gouvernementales quand elles existent, et d’aligner les mécanismes de contrôle utilisateur (portabilité, suppression, objection) avec les cadres en vigueur. Les tendances 2025 — montée du server‑side tracking, fin des cookies tiers, privacy by design et par défaut, adoption des PETs — confirment la direction: il faut moins collecter, mieux anonymiser, et prouver que les garanties sont effectives[^18].

---

## 8. Comparatif approfondi et implications produits

Au‑delà des architectures, ce qui différencie les plateformes, ce sont les compromis explicites entre fonctionnalités et confidentialité.

- Session: en supprimant les identifiants réels et en routant via onion routing, Session réduit fortement la création de métadonnées. En contrepartie, la création d’un compte entièrement pseudonyme peut faciliter des abus, et l’expérience multi‑appareils dépend d’un réseau décentralisé aux propriétés spécifiques (swarms). Les validations locales d’abonnement renforcent la cohérence “no‑knowledge” au niveau des paiements[^10][^11][^13].

- Signal: Sealed Sender est un mécanisme élégant pour masquer l’expéditeur sans sacrifier la prévention des abus. L’usage de certificats courts et de jetons liés aux clés de profil limite la surface de collecte, tout en conservant la capacité d’opérer un service à l’échelle. La découverte par hachage réduit l’exposition des contacts. La contrepartie tient aux métadonnées nécessaires au routage et à la synchronisation, et au fait que l’inscription repose sur un numéro de téléphone[^1][^2][^4].

- Wire: la robustesse opérationnelle, l’orientation entreprise et les audits indépendants créent un cadre de confiance et d’auditabilité rare. MLS ouvre la voie à des groupes plus grands avec des échanges de clés efficaces. Les notifications push sont sans contenu et l’alternative websockets/F‑Droid réduit la dépendance FCM. Les métadonnées conservées concernent le fonctionnement et la synchronisation, ce qui est compatible avec une posture NO‑LOG pragmatique, à condition d’être documentées et limitées[^6][^7][^8][^22].

Le tableau ci‑après structure les compromis clés.

Tableau 4 — Matrice de compromis fonctionnalités vs confidentialité

| Fonctionnalité | Signal | Session | Wire | Impact utilisateur | Risques | Mitigation |
|---|---|---|---|---|---|---|
| Inscription sans téléphone | Non | Oui | À clarifier | Anonymat vs facilité | Abus potential | Limites anti‑abus, validation locale |
| Sealed Sender | Oui | N/A | N/A | Moins de métadonnées expéditeur | Abus hors contacts | Restreindre hors contacts, rate‑limiting |
| Découverte contacts | Hachage client | Non centralisée | Synchronisation contacts | Contrôle vs couverture | Exposition annuaire | Hachage, opt‑in, révocation |
| Multi‑appareils | Oui | Oui (via swarms) | Oui | Continuité d’usage | Métadonnées routage | Éphémérisation, documents de finalité |
| Notifications | APN/FCM (sans contenu) | Push via infrastructure | APN/FCM, websockets/F‑Droid | Alertes sans fuite contenu | Tokens push | Rotation, expiration, websockets |
| Paiement/Abonnement | N/A dans sources | Preuves locales Pro | Cadre entreprise |隐私 vs vérification | Corrélation identité/paiement | Découplage, preuves zero‑knowledge |
| Appels | E2EE media | P2P (IP exposée) | E2EE media | Qualité vs exposition IP | Analyse trafic | TURN chiffré, minimisation IP |
| Groupes à grande échelle | E2EE groupes | Modèle distribué | MLS roadmap | Scalabilité vs sécurité | Complexité | Audits, tests负载, paramétrage |

Les choix d’architecture doivent être guidés par le modèle de menace et les exigences marché. Pour une messagerie ciblant la confidentialité forte, Session montre une voie radicale; pour un service grand public évolutif, Signal fournit des mécanismes de dissimulation compatibles avec l’échelle; pour un environnement d’entreprise, Wire apporte la garantie d’audits et une gouvernance alignée RGPD.

---

## 9. Feuille de route 2025 et checklist de mise en œuvre

Pour concevoir et opérer une messagerie NO‑LOG avec synchronisation, nous recommandons une feuille de route en six phases, adossée à une checklist d’ingénierie, gouvernance et contrôle.

Phases d’exécution:
1) Architecture: choisir le modèle (décentralisé vs central minimal), définir les PETs (hachage, enveloppes, routage en oignon, MLS), spécifier les Artefacts Techniques Minimaux (ATI).
2) Implémentation: développer la validation locale, les enveloppes chiffrées, les certificats courts, les messages de configuration, les mécanismes anti‑abus calibrés.
3) Audit: tests de pénétration, revues cryptographiques, validations de configuration par défaut privées, contrôle des flux de données.
4) Publication: transparence sur les politiques, métriques de conservation, explanations des risques et options pour l’utilisateur.
5) Support: gestion des droits (accès, effacement, portabilité), information sur transferts transfrontaliers, canaux sécurisés.
6) Amélioration continue: suivi des incidents, feedback utilisateur, mises à jour de sécurité, ajustements anti‑abus.

La checklist ci‑dessous structure les preuves attendues.

Tableau 5 — Checklist NO‑LOG & synchronisation

| Exigence | Description | Preuve documentaire | Métrique | Responsable | Statut |
|---|---|---|---|---|---|
| Politique NO‑LOG | Portée, exceptions, finalités | Politique privacy publiée | % de métadonnées réduites | Conformité | Planifié |
| Minimisation | ATI définis et bornés | Spéc. technique | Durée max rétention | Produit | En cours |
| Synchronisation | Messages de config chiffrés | Design docs | % d’opérations locales | Ingénierie | En cours |
| Validation locale | Preuves cryptographiques | Revue crypto | % de vérifs locales | Sécurité | Planifié |
| Notifications | Push sans contenu, websockets | Tests APN/FCM/websockets | % de notifications sans contenu | App mobile | En cours |
| Multi‑appareils | Routage avec éphémérisation | Audit logs techniques | TTL moyen des tokens | Backend | En cours |
| Appels | Minimisation IP (TURN) | Config réseau | % de sessions chiffrées | Réseau | Planifié |
| Portabilité | Export E2EE | Guide utilisateur | Délai moyen | Support | Planifié |
| Suppression | Effacement à la demande | Procédure | Délai d’effacement | Support | En cours |
| Transferts | Déclarations transfrontalières | Politique/legal | % de données transférées | Legal | En cours |

Cette feuille de route intègre les tendances 2025 (privacy by default, server‑side tracking, adoption des PETs) et les lignes directrices EDPB sur l’articulation DMA/RGPD/DSA. Elle s’appuie sur les exemples concrets de Session (preuves locales, synchronisation par messages de configuration) et de Sealed Sender (enveloppes et certificats courts), ainsi que sur les mécanismes Wire de notifications “clean” et d’audits réguliers[^2][^8][^13][^17][^18].

---

## 10. Annexes

Glossaire:
- End‑to‑End Encryption (E2EE): chiffrement de bout en bout; le contenu n’est lisible que par les extrémités.
- Messaging Layer Security (MLS): standard pour le chiffrement de groupe, optimisant l’évolutivité et la sécurité des échanges de clés.
- Swarms: groupes de nœuds dans Session, assurant un stockage temporaire distribué des messages pour destinataires hors ligne.
- Preuve cryptographique: artefact vérifiable localement attestant d’un statut (ex: Pro) sans révéler l’identité.
- Onion routing: acheminement de messages via plusieurs couches de chiffrement à travers plusieurs nœuds, chacun ne connaître qu’un tronçon.
- Jetons de livraison: secrets dérivés des clés de profil, exigés pour transmettre des messages Sealed Sender et limiter les abus.
- APN/FCM: services de notification Apple/Google, utilisés sans contenu de message.

Ressources:
- Signal — Conditions d’utilisation & Politique de confidentialité.
- Signal — Sealed Sender.
- Signal — Découverte de contacts, Profils.
- Wire — Security & Privacy, Security Whitepaper, Privacy Whitepaper.
- Session — Site officiel, FAQ, Documentation, Whitepaper, Nym — What is Session.
- EDPB — Guidelines 3/2025 sur l’interaction DSA/RGPD (PDF); article de communication.
- Usercentrics — Tendances 2025.

Notes méthodologiques et limites:
- Signal: la dernière mise à jour publique de la politique légale citée date de 2018; une vérification 2025 reste recommandée[^1].
- Wire: la politique ne détaille pas la rétention des logs operacionais; des clarifications sont à souhaiter[^9].
- Session: l’absence d’un document unique “Politique NO‑LOG 2025” impose de combiner whitepaper, site et analyses indépendantes[^10][^11][^12][^13].
- EDPB: une page d’annonce étant inaccessible (403), nous nous fondons sur l Guidelines 3/2025 (PDF) et un article de communication[^17][^19].
- Métadonnées réseau: exposition IP dans les appels P2P et détails FCM/APN (Session/Signal) exigent une documentation plus fine pour une comparaison exhaustive[^11].

Checklist d’audit:
- Vérifier la portée de la journalisation côté service et les durées de conservation.
- Confirmer la nature éphémère des buffers et des tokens.
- Tester les mécanismes de validation locale et les expirations de certificats.
- Auditer les flux de notifications (absence de contenu, rotation des jetons).
- Confirmer la minimisation des données de synchronisation et le bornage des finalités.
- Documenter les transferts transfrontaliers et les garanties associées.
- Évaluer l’exposition IP dans les appels et l’efficacité des mitigations (TURN chiffré).

---

## Références

[^1]: Signal — Terms of Service & Privacy Policy. https://signal.org/legal/
[^2]: Signal — Technology preview: Sealed sender. https://signal.org/blog/sealed-sender/
[^3]: Signal — Signal Profiles (Beta). https://signal.org/blog/signal-profiles-beta/
[^4]: Signal — Contact Discovery. https://signal.org/blog/contact-discovery/
[^6]: Wire — Security & Privacy. https://wire.com/en/security
[^7]: Wire Security Whitepaper (PDF). https://wire-docs.wire.com/download/Wire+Security+Whitepaper.pdf
[^8]: Wire Privacy Whitepaper (PDF). https://wire-docs.wire.com/download/Wire+Privacy+Whitepaper.pdf
[^9]: Wire — Privacy Policy. https://wire.com/en/privacy-policy
[^10]: Session — Send Messages, Not Metadata (site officiel). https://getsession.org/
[^11]: Nym — What is Session Messenger? https://nym.com/blog/what-is-session
[^12]: Session — Frequently Asked Questions. https://getsession.org/faq
[^13]: Session Pro Beta — Privacy-Preserving Pro Verification. https://getsession.org/blog/session-pro-beta
[^14]: Kaspersky — Messengers privacy rating 2025. https://www.kaspersky.com/blog/messengers-privacy-rating-2025/54665/
[^17]: EDPB — Guidelines 3/2025 on the interplay between the DSA and the GDPR (PDF). https://www.edpb.europa.eu/system/files/2025-09/edpb_guidelines_202503_interplay-dsa-gdpr_v1_en.pdf
[^18]: Usercentrics — Data Privacy Trends 2025. https://usercentrics.com/guides/data-privacy/data-privacy-trends/
[^19]: EDPB & European Commission — Joint guidelines on DMA and GDPR. https://www.edpb.europa.eu/news/news/2025/dma-and-gdpr-edpb-and-european-commission-endorse-joint-guidelines-clarify-common_en
[^22]: Wire — Messaging Layer Security (MLS). https://wire.com/en/messaging-layer-security
[^23]: Session Whitepaper (arXiv PDF 2002.04609). https://arxiv.org/pdf/2002.04609