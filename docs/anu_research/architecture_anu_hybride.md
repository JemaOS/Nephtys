# Blueprint architectural hybride pour Anu: P2P temps réel + Cloud chiffré pour synchronisation

## 1. Résumé exécutif et principes directeurs

Anu vise une expérience de messagerie qui concilie confidentialité, sécurité, performance et disponibilité sans妥协. L’ambition du présent blueprint est de spécifier une architecture hybride combinant communications pair-à-pair (P2P) en temps réel et synchronisation via un cloud chiffré côté client. Cette combinaison permet de réduire la latence et la dépendance à l’infrastructure pour les interactions en direct, tout en offrant une cohérence robuste, une résilience et des capacités offline-first au niveau du cloud.

Le principe directeur est double. En premier lieu, le temps réel privilégie les flux P2P avec chiffrement de bout en bout (E2EE), tandis que les états persistants (conversations, métadonnées minimisées, index de recherche, journaux de livraison) sont synchronisés vers un cloud chiffré côté client. En second lieu, la protection des métadonnées n’est pas un supplément, mais un axe structurant: l’anonymisation réseau (routage en oignon), le masquage d’identifiants applicatifs, et le durcissement des API sont conçus de concert pour réduire au minimum l’exposition des comportements d’usage.

Trois références guident ce design. Signal illustre l’état de l’art E2EE avec des garanties de sécurité fortes, notamment pour les conversations 1:1 et la gestion de secrets sur l’appareil; Wire opère une transition vers Messaging Layer Security (MLS) pour les groupes, apporter une efficacité et une scalabilité de gestion de clés de groupe; Session démontre un modèle décentralisé avec stockage par essaims et routage en oignon, qui inspire notre stratégie anti-métadonnées tout en rappelant les compromis de performance et d’implémentation. Ce blueprint intègre leurs apprentissages pour un système cohérent orienté utilisateur et développeur, et s’appuie notamment sur la formalisation MLS définie par la RFC 9420[^4], qui structure la gestion de clés de groupe et la scalabilité associé au chiffrement de bout en bout à large échelle.

Objectifs de sécurité et de performance:
- Confidentialité et E2EE par défaut, y compris pour les conversations de groupe, avec des mécanismes de renégociation et de rotation de clés adaptés aux besoins de l’expérience temps réel.
- Anonymisation et minimisation des métadonnées: séparation des plans de signalisation et de contenu, utilisation d’identifiants opaque, routage en oignon et politiques de rétention strictes.
- Latence en temps réel inférieure à 500 ms de bout en bout sur les chemins P2P, avec un TURN budget maîtrisé et des codecs adaptés.
- Cohérence forte et mécanismes de réconciliation sans conflit (CRDT) pour les états persistants synchronisés vers le cloud; livraison fiable avec acknowledgement et reprise de transferts.

Approche par cas d’usage:
- 1:1 — Signal Protocol (Double Ratchet) pour les messages et appels; flux P2P direct ou relayé TURN; synchronisation via cloud chiffré (accusés de réception, index de recherche).
- Groupes — MLS pour la gestion de clés de groupe, la mise à l’échelle et la résilience; flux temps réel P2P quand possible; synchronization cloud avec états et index chiffrés.
- Appels audio/vidéo (A/V) — SRTP sur DTLS via WebRTC; P2P prioritaire, TURN en secours; adaptation ducodec et contrôle de congestion; synchronisation d’artefacts (log, transcription opt-in).
- Appareils multiples — Secrets stockés et derivés côté client; synchronisation d’états CRDT par device via le cloud chiffré; politiques de séparation par appareil et révocation.

Résumé des arbitrages:
- Anonymisation vs latence: le routage en oignon renforce la confidentialité des métadonnées réseau mais ajoute de la latence; la signalisation anonymisée et les chemins P2P directs réduisent les délais pour le contenu, tout en cloisonnant les métadonnées sensibles.
- Résilience vs complexité: la couche P2P nécessite des budgets TURN et des stratégies de fallback; le stockage cloud chiffré demande une gestion de clés robuste et des politiques de rétention; l’ensemble augmente la charge d’ingénierie et d’opération.
- Scalabilité de groupe vs coûts: MLS réduit les coûts de gestion de clés côté client, mais implique un serveur d’authentification et une orchestration rigoureuse; le dimensionnement TURN et les clusters CRDT doivent être calibrés par des tests de charge.

Lacunes d’information à noter dès maintenant:
- Benchmarks chiffrés et actuels des performances A/V et des délais de livraison P2P avec et sans TURN.
- Paramètres opérationnels exacts du réseau Session et coûts d’infrastructure associés.
- Exigences précises de conformité (périmètre RGPD, rétention, export réglementaire) selon les juridictions cibles.
- Choix définitif des fournisseurs cloud (périmètre multi-régions, KMS, budgets TURN).
- Modèle économique et SLA visés (débit de messages, taille max de groupe, quotas média).

Ces écarts sont adressés par une feuille de route de validation technique et une stratégie de tests de performance au fil des itérations, sans compromettre les principes structurants décrits ci-dessous.

## 2. Vue d’ensemble de l’architecture cible Anu

La vue d’ensemble de l’architecture cible organise Anu en couches spécialisées qui isolent les responsabilités, minimisent l’exposition des métadonnées et offrent des garanties opérationnelles claires. La figure ci-dessous synthétise les flux logiques entre le plan de contenu P2P (temps réel), la signalisation, le service d’authentification MLS, et le cloud chiffré de synchronisation.

Pour contextualiser les responsabilités de chaque composant, le tableau 1 cartographie les éléments clés et leurs obligations, depuis le client et son stockage local jusqu’aux services de clés et de minimisation des métadonnées.

Tableau 1 — Cartographie des composants et responsabilités
| Composant | Responsabilités principales | Données manipulées | Exigences de sécurité |
|---|---|---|---|
| Client mobile/desktop | UI, stockage local chiffré, P2P WebRTC, CRDT | Messages, états CRDT, clés dérivées, index chiffrés | E2EE, isolation par appareil, durcissement local |
| Signalisation | Création/adhésion aux sessions P2P, exchange ICE | SDP, candidats ICE, handles opaques | TLS, logs minimisés, séparation d’identité |
| STUN/TURN | Découverte NAT,relais media/données | Paquets media/données relayés | Chiffrement SRTP/DTLS, coûts et budgets maîtrisés |
| Service d’authentification MLS | Authentifier membres, orchestrer ratchet tree, émettre welcome | États de groupe, welcome, epoch | Contrôle d’accès, journaux minimaux |
| Cloud chiffré (objets) | Synchronisation, résilience, multi-device | Objets chiffrés côté client (messages, états) | Chiffrement côté client, lifecycle/rétention |
| Stockage d’index chiffrés | Indexation de contenu chiffré, recherche locale | Index de messages/pièces jointes | Accès contrôlé, purge/gc, audit |
| Service de minimisation métadonnées | Pseudonymisation, agrégation, anonymisation | Agrégats techniques, compteurs | K-anonymat, rétention courte, audit |

Cette séparation est fondamentaux pour la protection des métadonnées: la signalisation ne contient aucun identifiant direct d’utilisateur, les chemins P2P sont préférés pour le contenu, et le cloud ne stocke que des objets chiffrés avec des index opaques et des politiques de purge.

### 2.1 Flux logiques et boundaries

Le flux temps réel suit un chemin P2P quand la connectivité le permet; en cas de NAT restrictif, un relais TURN prend le relais avec un budget limité. Les événements de groupe (invitation, mise à jour d/epoch) transitent via le service MLS, alors que les métadonnées de session sont réduites au strict nécessaire.

Le flux de synchronisation vers le cloud fonctionne de manière append-only pour les journaux de messages, avec compaction périodique et garbage collection. L’état de conversation, lesindex de recherche et les journaux de livraison sont chiffrés côté client avant envoi. Les conflits éventuels sont résolus par CRDT, garantissant une cohérence forte sans verrou global.

Les métadonnées sensibles sont cloisonnées par limites d’exposition: l’identité réelle n’apparaît jamais en clair dans la signalisation; les handles sont opaques et régulièrement rotatifs; les journaux sont agrégés et minimisés.

### 2.2 Contrats d’interface et trust model

Chaque interface explicite ses garanties de confidentialité, disponibilité et intégrité. Le plan de contenu P2P apporte une latence minimale, le plan de signalisation apporte une découverte et une orchestration minimisées, le cloud fournit la résilience et la synchronisation, et le service MLS structure l’authentification et la gestion de clés de groupe.

Tableau 2 — Contrats d’interface (API et garanties)
| API | Opérations | Entrées/Sorties | Garanties attendues |
|---|---|---|---|
| Signalisation WebRTC | create/join, ICE exchange, candidates | SDP, candidates opaques | TLS, minimisation métadonnées, idempotence |
| MLS GroupOps | join, leave, commit, epoch update | Membership, welcome | Authentification, atomicité commit, journaux minimaux |
| Sync Cloud | upload/download objets, GC | Blobs chiffrés, index chiffrés | E2EE côté client, cohérence eventually consistent, purge |
| A/V P2P | start/stop, stats | Codec params, stats | SRTP/DTLS, adaptation dynamique, fallback TURN |

Cette structuration réduit la surface d’attaque, clarifie les responsabilités et facilite le durcissement par des contrôles d’accès et des politiques de rétention.

## 3. Analyse comparative des architectures de référence

Pour éclairer les choix d’Anu, nous comparons Signal, Wire et Session selon les axes sécurité, métadonnées, performance, scalabilité et complexité d’implémentation.

Tableau 3 — Comparatif Signal/Wire/Session
| Système | Modèle chiffrement 1:1 | Modèle chiffrement groupe | Métadonnées réseau | Architecture P2P | Stockage sync | Complexité d’implémentation |
|---|---|---|---|---|---|---|
| Signal | Signal Protocol (Double Ratchet) | Par défaut groupes basés sur pairs; évolutions | Minimisation, mais infra centralisée de signalisation | P2P via WebRTC; TURN en secours | Cloud (synchronisation) | Élevée (cryptographie avancée) |
| Wire | Signal Protocol (1:1) | Migration vers MLS | Métadonnées réduites; E2EE | WebRTC pour A/V; serveurs centralisés | Cloud pour sync | Élevée (intégration MLS) |
| Session | Signal Protocol modifié | Groupes via infrastructure dédiée | Routage oignon, forte anonymisation | P2P via Lokinet; essaims de stockage | Stockage par essaims (décentralisé) | Très élevée (réseau décentralisé) |

Signal demeure la référence E2EE 1:1, avec une sécurité éprouvée; Wire a élargi l’approche via MLS pour les groupes, ce qui offre une meilleure scalabilité et une gestion de clés plus efficace; Session démontre la valeur de l’anonymisation réseau et du stockage décentralisé, mais au prix d’une latence accrue et d’une complexité opérationnelle significative. L’architecture d’Anu s’approprie les points forts: E2EE 1:1 via Signal Protocol, MLS pour les groupes, P2P temps réel, et cloud chiffré pour la synchronisation, avec une minimisation des métadonnées inspirée de Session mais adaptée pour une latence acceptable[^5][^1][^3].

### 3.1 Signal: enseignements clés

Signal illustre la robustesse du Double Ratchet pour 1:1: confidentialité persistante, résilience à la compromission de clés, et rotation automatique. La minimisation des métadonnées reste un sujet de vigilance dans un modèle à signalisation centralisée: le cloisonnement des identités et la pseudonymisation y sont cruciaux. Pour Anu, ce socle E2EE 1:1 est acquis, avec des extensions pour le multi-appareil et une synchronisation d’état via CRDT.

### 3.2 Wire: MLS et scalabilité de groupe

Wire illustre la transition vers MLS (RFC 9420) pour gérer la croissance des groupes et améliorer les performances de mise à jour de clés. La structure TreeKEM et le ratchet tree réduisent la complexité et les coûts de communication; les secrets d’époch et les mécanismes de bienvenue (welcome) structurent le cycle de vie des membres[^4][^1]. Anu adopte MLS pour les groupes, ce qui aligne les garanties E2EE et la scalabilité opérationnelle.

### 3.3 Session: décentralisation et anti-métadonnées

Session démontre une approche de réseau décentralisé où les « Session Nodes » orchestrent des requêtes en oignon et des réplications par essaims (swarm). Le routage multi-sauts isole l’identité de l’utilisateur du chemin réseau; le stockage par swarm augmente la résilience, mais introduit une latence et une complexité accrues. Les leçons pertinentes pour Anu sont la valeur de la séparation des métadonnées, la distribution de responsabilité, et l’importance d’un budget de latence maîtrisé pour l’expérience temps réel[^3].

## 4. Couche P2P temps réel: WebRTC, NAT traversal, anonymisation réseau

La couche P2P temps réel est construite sur WebRTC, combinant DTLS pour la sécurisation des canaux et SRTP pour les médias. Le NAT traversal s’appuie sur STUN pour la découverte d’adresse et sur TURN pour les cas où la connexion P2P directe n’est pas possible. L’anonymisation des métadonnées réseau est renforcée par une signalisation séparée et des chemins oignon partiels sur les flux critiques. Les objectifs de latence sont fixés à moins de 500 ms de bout en bout, avec un budget TURN strictement limité.

Tableau 4 — Paramètres de latence et budgets
| Chemin | Budget cible | Composants du délai | Politique de fallback |
|---|---|---|---|
| P2P direct | < 300 ms | Signalisation, ICE, handshakes DTLS/SRTP | N/A |
| Relay TURN | < 500 ms | relay hop, file d’attente, congestion | Budget max par session, bascule audio-only |

L’architecture privilégie le P2P direct; TURN n’est activé que si la connectivité l’impose, avec bascule automatique vers des profils de débit et codec plus économiques (par exemple Opus pour l’audio, VP8 pour la vidéo) afin de respecter les budgets.

Tableau 5 — Politique de codecs
| Scénario | Audio | Vidéo | Débit cible | Jitter/drop |
|---|---|---|---|---|
| Réseau optimal | Opus (48 kHz) | VP8/H.264 | Audio 32–64 kbps; Vidéo 1–2 Mbps | Jitter buffer adaptatif; FEC/RTX selon besoin |
| Réseau contraint | Opus (16–32 kHz) | VP8 (réduit) | Audio 16–32 kbps; Vidéo 200–500 kbps | PLC, adaptative bitrate, reducción résolution |
| Appels longs | Opus (variable) | H.264 (SVC si dispo) | Dynamique | Contrôle de congestion, pacing |

Ces profils sont ajustés dynamiquement en fonction des retours de statistiques WebRTC (packet loss, RTT, jitter). La bascule audio-only est prévue lorsque la latence dépasse les budgets ou que la perte de paquets augmente.

### 4.1 Connectivité: STUN/TURN et fallbacks

La découverte de pair repose sur des ICE candidates qui combinent adresses publiques (STUN) et relais (TURN) selon les types de NAT. Le budget de relais est paramétré par session et par période, avec des quotas journaliers pour éviter les dérives de coûts et de latence. La bascule P2P→TURN→audio-only se fait selon une politique adaptative: priorité à la qualité et à la latence, puis au coût, et enfin à la disponibilité minimale.

### 4.2 Signalisation anonymisée

La signalisation est séparée du plan de contenu; elle ne transporte aucun identifiant utilisateur direct. Les endpoints utilisent des handles opaques et des tokens éphémères. Les journaux de signalisation sont minimisés, agrégés, et assortis d’une rétention courte. Cette approche réduit sensiblement la surface de fuite des métadonnées tout en permettant l’observabilité nécessaire au diagnostic réseau.

## 5. Cloud chiffré pour synchronisation: chiffrement côté client, CRDT, résilience

La synchronisation vers le cloud est entièrement chiffrée côté client. Les objets (messages, états de conversation, index) sont chiffrés avant upload, avec des métadonnées minimales (opaque handles, horodatages approximatifs). Le modèle d’accès s’appuie sur des ACL et des tokens d’appareil. La cohérence est garantie par des CRDT (Conflict-free Replicated Data Types) qui autorisent des réplicas indépendants et des fusions déterministes sans conflit. La disponibilité et la durabilité sont assurées par une réplication multi-région et des politiques explicites de versioning, compaction et garbage collection.

Tableau 6 — Modèle de données CRDT (types, opérations, idempotence)
| Type CRDT | Opérations | Propriétés | Garanties de fusion |
|---|---|---|---|
| LWW-Element-Set (identifiants) | add, remove, update timestamp | Idempotence add, commutativité updates | Convergence vers même état final |
| OR-Set (objets) | add, remove, retrieve | Idempotence add, remove sur tags | Fusion sans conflit, preserve ajout/retrait |
| PN-Counter (compteurs) | inc, dec | Commutativité inc/dec | Valeur exacte indépendamment de l’ordre |
| RGA (texte/列表) | insert, delete | Ordre partiel preserved | Fusion cohérente, cohérence séquentielle |
| MV-Register (métadonnées) | assign, merge | Convergence par last-writer | Valeur convergeante déterministe |

Cette base CRDT, inspirée de modèles的理论 et d’implémentations opérationnelles, permet la cohérence forte en présence de partitions temporaires, tout en restant simple àreasonner sur les garanties de fusion et d’idempotence[^2].

Tableau 7 — Politique de clés (dérivation, rotation, séparation par appareil)
| Scénario | Dérivation | Rotation | Rétention | Révocation |
|---|---|---|---|---|
| 1:1 (Signal Protocol) | HKDF à partir de master secret device | À la demande (renégociation) | Sur appareil uniquement | Reset device, purge storage |
| Groupe (MLS) | Secrets d/epoch, welcome secrets | À chaque commit/epoch | Stockage minimal, index chiffrés | Group leave, epoch rollback |
| Stockage cloud | Master key par device + per-object salts | Mensuelle/à l’usage | Logs courts, GC | Token invalidation, key rotation |
| Index de recherche | Derived keys par conversation | Trimestrielle | Purge à l’expiration | Rebuild index, re-chiffrement |

La séparation par appareil est essentielle: chaque device possède ses secrets, et aucun secret n’est centralisé en clair. La rotation est opérée sans interruption de service: les nouveaux objets utilisent les nouvelles clés; les anciens sont migrés en arrière-plan.

### 5.1 Chiffrement côté client et gestion de clés

Les clés sont dérivées localement via HKDF, et ningún secret n’est jamais envoyé au cloud. Le schéma de ségrégation sépare les clés 1:1, de groupe, et de stockage; la rotation est asynchrone et pilotée par des politiques d’usage et de sécurité. La séparation par appareil s’appuie sur des sels et des métadonnées minimales pour prévenir les corrélations.

### 5.2 CRDT et réconciliation sans conflit

La réconciliation utilise des opérations commutatives et idempotentes. Les conflits sont résolus par des règles déterministes (LWW, merge par last-writer, convergence PN-Counter). La compaction et le garbage collection sont planifiés: les journaux d’événements sont compactés en snapshots chiffrés; l’historique est trimé selon des politiques de rétention. Ces mécanismes, en ligne avec les principes CRDT, fournissent une cohérence forte en environnement partitionné[^2].

## 6. Gestion des métadonnées et confidentialité

La gestion des métadonnées est une priorité absolue. La minimisation consiste à collecter uniquement ce qui est strictement nécessaire au fonctionnement (par exemple, handles opaques, horodatages approximatifs). La pseudonymisation et la rotation d’identifiants réduisent la corrélation temporelle. La confidentialité différentielle peut être appliquée aux agrégats, avec des paramètres de k-anonymat et des seuils de population. L’anonymisation réseau via oignon sur les flux critiques limite l’exposition de l’IP et des chemins. Les politiques de rétention et purge sont strictes, avec audit et traçabilité.

Tableau 8 — Taxonomie des métadonnées
| Catégorie | Exemples | Nécessité | Risque | Politique de rétention |
|---|---|---|---|---|
| Identification | Handle opaque, device ID | Élevée | Corrélation | Rotation fréquente, logs courts |
| Contenu | Messages, médias | Élevée | Exfiltration | Chiffrés côté client, purge standard |
| Réseau | IP, ports, routes | Moyenne | Profilage | Oignon, minimisation, non-persistance |
| Comportement | Temps d’activité, latence | Moyenne | Inférence | Agrégation, confidentialité différentielle |
| Appareil | Versions OS, codecs | Faible–Moyenne | Fingerprinting | Minimisation, fuzzing paramètres |
| Observabilité | Stats A/V, erreurs | Moyenne | Corrélation | Anonymisation, rétention courte |

Tableau 9 — Registre de rétention et purge
| Type | Durée | Base légale | Méthode de purge | Points de contrôle |
|---|---|---|---|---|
| Journaux signalisation | 7–14 jours | Intérêt légitime OpEx | Rotation, agrégation | Audit trimestriel |
| Index chiffrés | 90 jours | Service | GC, re-chiffrement | Contrôle d’accès, logs |
| Métadonnées réseau (anonymisées) | 30 jours | Sécurité | Agrégation puis discard | K-anonymat vérifié |
| Artefacts A/V (opt-in) | 30 jours | Consentement | Suppression définitive | Consentement traçable |

Cette structuration est inspirée des principes de minimisation et d’anonymisation développés par des travaux de confidentialité (par exemple, les stratégies d’E2EE et de protection des métadonnées présentées dans les ressources académiques), et de l’approche anti-métadonnées de Session (routage oignon, cloisonnement d’identité)[^5][^3].

### 6.1 Minimisation et pseudonymisation

Les identifiants utilisateurs sont représentés par des handles opaques; les liens inter-sessions sont évités; les horodatages sont approximatifs si la précision n’est pas indispensable. La pseudonymisation repose sur des pseudonymes rotatifs et une séparation des domaines d’identifiants.

### 6.2 Anonymisation réseau

La signalisation est isolée du contenu et s’appuie sur des endpoints anonymes; une couche oignon optionnelle peut masquer la route réseau. Les politiques de logs réseau sont minimales et anonymisées. Le cloisonnement entre identités logiques et adresses réseau réduit fortement la surface de corrélation.

## 7. Protocoles cryptographiques et gestion des clés

La dimension cryptographique d’Anu combine deux références complémentaires: Signal Protocol pour les interactions 1:1 (Double Ratchet) et MLS pour les groupes (RFC 9420). Cette dualité apporte des garanties distinctes et complémentaires: le premier offre une sécurité solide et éprouvée pour les échanges de pair à pair; le second permet une gestion efficace et scalable des clés de groupe, avec des mises à jour atomiques et des ratchet trees qui réduisent le coût de coordination[^5][^4]. Les secrets sont gérés côté client, sans centralisation en clair, et la rotation est orchestrée de manière transparente. Les artefacts (welcome, epoch update) sont manipulés avec des politiques strictes d’accès et d’audit.

Tableau 10 — Matrice de gestion des clés
| Domaine | Secret | Stockage | Rotation | Révocation | Garanties |
|---|---|---|---|---|---|
| 1:1 (Signal) | Master secret device | Device only | Renégociation | Reset device | PFS, post-compromise security |
| Groupe (MLS) | Epoch secrets, welcome | Client + service | Commit/epoch | Group leave | Scalabilité, atomicité |
| Cloud sync | Per-object keys | Client only | Périodique | Token invalidation | E2EE, séparation par appareil |
| Index chiffrés | Derived keys | Client only | Trimestrielle | Rebuild index | Minimisation métadonnées |

### 7.1 Signal Protocol (Double Ratchet) pour 1:1

Le Double Ratchet garantit la confidentialité persistante et la résilience en cas de compromission d’une clé. Les messages manqués sont récupérés via les mécanismes de step-up, et les clés sont avancées à chaque message. La gestion multi-appareils repose sur des stockage séparés des secrets par device, avec synchronisation d’état via CRDT et politiques de révocation locales[^5].

### 7.2 MLS pour les groupes

MLS, tel que défini par la RFC 9420, structure les opérations de groupe (join, leave, commit), le ratchet tree et les mises à jour d/epoch de manière atomique. Les welcome secrets orchestrent l’onboarding des membres. Les stratégies de pre-shared keys (PSK) peuvent réduire la latence de rejoin et la friction de démarrage de nouveaux membres. Cette approche offre une scalabilité de groupe avec une complexité maîtrisée côté client[^4][^1].

## 8. Performance et optimisation

Les objectifs de performance d’Anu sont explicites: une latence temps réel cible inférieure à 500 ms, un taux de connexion P2P élevé, et une synchronisation fiable vers le cloud. Les budgets sont suivis par métrique, et des techniques d’optimisation réseau, codecs et transport sont déployées pour maximiser l’expérience.

Tableau 11 — Objectifs de performance et budgets
| Métrique | Cible | Mesure | Alertes |
|---|---|---|---|
| Latence E2E temps réel | < 500 ms | RTT, one-way delay | Alerte > 500 ms |
| Taux P2P direct | > 80% | ICE success, TURN usage | Alerte < 70% |
| Défaillance TURN budget | < 5% sessions | Relay budget hits | Alerte > 10% |
| Latence sync cloud | < 1 s (95e) | Upload/download times | Alerte > 2 s |
| FCRDT merge | < 100 ms | Merge time per op | Alerte > 200 ms |

Tableau 12 — Techniques d’optimisation par couche
| Couche | Techniques | Indicateurs |
|---|---|---|
| Réseau | ICE最优, pacing, congestion control | RTT, packet loss |
| Codec | Opus ABR, VP8/H.264 param tuning | Bitrate, quality score |
| Transport | DTLS/SRTP tuning, NACK/FEC/RTX | Jitter, drop rate |
| Observabilité | Stats WebRTC, tracing minimal | SLOs, erreurs |

### 8.1 Budget de latence et observabilité

Le budget de latence ventile les contributions (signalisation, handshakes, transport media, buffer). L’observabilité s’appuie sur des statistiques WebRTC (RTT, jitter, packet loss) et un tracing minimal qui respecte la minimisation des métadonnées. Des dashboards mesurent les objectifs de latence et déclenchent des alertes.

## 9. Implémentation, stack et roadmap

La stack recommandée privilégie des technologies éprouvées, avec une attention particulière à la sécurité et à l’intégration MLS. Les langages recommandés sont Kotlin (Android), Swift (iOS), et TypeScript (clients web), avec un backend microservices sécurisé. La base cryptographique repose sur libsodium et des implémentations MLS conformes à la RFC 9420. La couche P2P s’appuie sur WebRTC; la synchronisation utilise des CRDT en mode « offline-first » avec un cloud objet chiffré côté client. Le versioning de schéma et la migration des états sont planifiés pour éviter les interruptions.

Tableau 13 — Roadmap par phases et critères d’acceptation
| Phase | Livrables | Dépendances | Risques | Critères d’acceptation |
|---|---|---|---|---|
| P0 — E2EE 1:1 + P2P | Double Ratchet, WebRTC base | STUN/TURN, crypto libs | Bugs crypto | Latence < 500 ms (80% sessions) |
| P1 — MLS groupes | TreeKEM, GroupOps, welcome | Service MLS, clients | Intégration complexe | Epoch atomic, join/leave fiables |
| P2 — Cloud chiffré + CRDT | Upload/download, FCRDT | Cloud provider, KMS client | Conflits CRDT | Convergence sans conflit, GC opérationnelle |
| P3 — Métadonnées minimisées | Oignon, handles opaques | Signalisation, logs | Corrélations résiduelles | Audit rétention, k-anonymat |
| P4 — Observabilité et SLOs | Dashboards, tracing min | Phase 1–3 | Bruit métriques | SLOs respectés, alertes en place |

### 9.1 Stack recommandée

- Clients: Kotlin, Swift, TypeScript; WebRTC natif.
- Crypto: libsodium; библиотеки MLS conformes RFC 9420.
- Sync: CRDT library; cloud objet (chiffrement côté client).
- Observabilité: tracing minimal; métriques P2P et sync.

### 9.2 Phases et jalons

Chaque phase inclut des critères d’acceptation sécurité (tests cryptographiques, audits de rétention) et performance (SLOs). Les migrations de schéma sont versionnées avec une compatibilité ascendante, et des procédures de rollback sont définies pour limiter l’impact en cas d’incident.

## 10. Risques, mitigations et conformité

La gestion des risques opérationnels est intégrée à l’architecture. Les risques P2P incluent les pannes TURN, la connectivité faible et l’instabilité des codecs; la mitigation consiste en fallbacks et profils adaptatifs. Les risques cloud incluent l’indisponibilité régionale et la saturation; la mitigation repose sur la réplication multi-région et des quotas. Les risques cryptographiques incluent la complexité MLS et la gestion multi-appareils; la mitigation exige des tests intensifs et des revues de sécurité. Les risques de métadonnées incluent la ré-identification et la fuite par日志; la mitigation s’appuie sur l’anonymisation et la minimisation. La conformité RGPD est supportée par des politiques de rétention, de portabilité et de purge.

Tableau 14 — Registre des risques
| Risque | Probabilité | Impact | Mitigation | Propriétaire | Indicateurs |
|---|---|---|---|---|---|
| Panne TURN | Moyenne | Latence | Budget TURN, audio-only fallback | Réseau | Taux de relais, RTT |
| Échec connectivité P2P | Moyenne | Qualité | STUN optimisé, ICE tuning | Réseau | ICE success rate |
| Intégration MLS | Moyenne | Sécurité | POC, audits, tests | Crypto | Epoch/join success |
| Saturation cloud | Faible–Moyenne | Sync | Multi-région, autoscaling | Infra | Latence sync 95e |
| Fuite métadonnées | Faible–Moyenne | Conformité | Oignon, minimisation, audit | Sécurité | Logs, rétention, k-anon |
| Multi-appareils | Moyenne | Disponibilité | CRDT sync, révocations | Produit | Taux de converge state |

### 10.1 Stratégie de tests et validation

Les tests تشمل:
- Performance: latence E2E, TURN budget, ICE success, taux de P2P direct.
- Sécurité: revues cryptographiques, audits MLS, tests de révocation et rotation de clés.
- Résilience: fault injection sur TURN et cloud; scénarios de partition réseau; tests CRDT en présence de conflits.

Ces validations s’inscrivent dans une démarche de sécurité et de performance continue, en écho aux bonnes pratiques opérationnelles autour de l’E2EE et de la minimisation des métadonnées[^5].

## 11. Annexes

### A. Glossaire

- E2EE (End-to-End Encryption): chiffrement de bout en bout entre extrémités.
- Double Ratchet: mécanisme de rotation de clés обеспечивающий confidentialité persistante et résilience à la compromission.
- MLS (Messaging Layer Security): standard de chiffrement de groupe, défini par la RFC 9420.
- TreeKEM: structure d’arbre pour gérer les clés de groupe dans MLS.
- CRDT (Conflict-free Replicated Data Types): types de données répliqués garantissant convergence sans conflits.
- STUN/TURN: protocoles de découverte d’adresse et de relais pour NAT traversal.
- SRTP/DTLS: protocoles de sécurisation des médias et du handshake.
- Oignon: technique de routage en oignon pour anonymiser les métadonnées réseau.

### B. Matrice des décisions architecturales (ADR)

| Contexte | Décision | Alternatives | Conséquences |
|---|---|---|---|
| 1:1 E2EE | Signal Protocol | Protocoles propriétaires | Sécurité éprouvée, complexité |
| Groupes E2EE | MLS (RFC 9420) | Gestion de clés custom | Scalabilité, atomicité epoch |
| Temps réel | WebRTC + STUN/TURN | Protocoles personnalisés | Compatibilité, coût TURN |
| Sync | Cloud chiffré + CRDT | DB centralisée | Résilience, cohérence forte |
| Métadonnées | Minimisation + oignon | Logs détaillés | Protection, observabilité réduite |

### C. Spécifications d’interface (indicatives)

- Signalisation WebRTC: SDP et ICE fournis via TLS; handles opaques; tokens éphémères.
- GroupOps MLS: join/leave/commit; welcome secrets; epoch update.
- Sync Cloud: upload/download d’objets chiffrés; index; GC; politiques de rétention.

---

## Références

[^1]: Wire Whitepaper: End-to-End Encryption and Messaging Layer Security (MLS). https://wire.com/wp-content/uploads/2020/06/Wire-Group-E2EE-MLS-Whitepaper.pdf
[^2]: Redis CRDT based Active-Active: Deep Dive. https://redis.io/blog/active-active-crdts/
[^3]: Session Whitepaper: Decentralized Messaging with Onion Routing and Storage. https://arxiv.org/pdf/2405.15968
[^4]: RFC 9420: Messaging Layer Security (MLS). https://www.rfc-editor.org/rfc/rfc9420
[^5]: Formal Foundations for Secure Messaging (askarov et al.). https://askarov.net/papers/eurosp2020.pdf