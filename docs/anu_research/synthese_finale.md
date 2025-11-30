# Blueprint architectural Anu: P2P temps réel + cloud chiffré pour synchronisation

## Résumé exécutif

Anu requiert une architecture qui concilie sécurité de bout en bout, performance temps réel, protection avancée des métadonnées, synchronisation offline-first et scalabilité pour millions d’utilisateurs. La solution proposée est hybride par conception: un plan P2P chiffré pour les interactions en temps réel, combiné à un cloud chiffré côté client pour la synchronisation et la résilience.

Les piliers techniques sont les suivants:
- P2P temps réel via WebRTC optimisé, avec chiffrement SRTP/DTLS, traversal STUN/TURN et routage onion pour la signalisation anonymisée.
- Cloud chiffré côté client pour la synchronisation, avec CRDT (Conflict-free Replicated Data Types) garantissant une cohérence forte et une réconciliation sans conflit.
- Protocoles cryptographiques éprouvés: Signal Protocol pour les échanges 1:1, Messaging Layer Security (MLS) via TreeKEM pour les groupes, et chiffrement AES-256 pour les données.
- Protection des métadonnées par minimisation, pseudonymisation, sealed sender et séparation d'identité réseau.

Ce blueprint intègre les meilleures pratiques de Signal (E2EE, Double Ratchet), de Wire (MLS, TreeKEM) et de Session (onion routing, swarm storage), en les adaptant aux besoins spécifiques d’Anu. Il propose une feuille de route d’implémentation en 3 phases, des métriques de succès, et des recommandations de stack technologique. La mise en œuvre permettra de soutenir 5 millions d’utilisateurs actifs, avec des objectifs de latence sous 500 ms, 99,9% de disponibilité, et une scalabilité démontrée jusqu’à 100 000 utilisateurs par groupe[^2][^3][^4].

## Contexte et objectifs

Le besoin d’Anu est de proposer une messagerie sécurisée garantissant:
- Sécurité de bout en bout et confidentialité forte, avec une protection robuste des métadonnées.
- Performance temps réel pour les appels et messages instantanés.
- Synchronisation offline-first multi-appareils avec cohérence forte.
- Scalabilité pour millions d’utilisateurs et groupes de grande taille.

Contraintes:
- P2P pour minimiser la latence et les coûts d’infrastructure.
- Cloud chiffré côté client pour la synchronisation et la résilience.
- Conformité RGPD avec minimisation et pseudonymisation des données.

## Architecture de référence: P2P temps réel + Cloud chiffré

La solution cible est structurée autour de six composants principaux:

1. **Signalisation WebRTC anonymisée**: sépare les métadonnées de contenu via OnionProxyService, garantissant l’anonymat réseau.
2. **P2P temps réel chiffré**: utilise WebRTC DataChannel pour messages et SRTP/DTLS pour appels, avec codecs optimisés (Opus, VP8/H.264).
3. **Authentification MLS**: intègre le protocole MLS (RFC 9420) et TreeKEM pour la gestion des clés de groupe, assurant la scalabilité et la sécurité.
4. **Chiffrement côté client**: dérivé de secrets utilisateurs avec AES-256, sécurise les données avant upload cloud.
5. **Synchronisation CRDT**: utilise des CRDTs avec Redis pour la cohérence forte et la réconciliation sans conflit.
6. **Stockage cloud sécurisé**:基础设施 multi-régions chiffrée, avec séparations réseau et stockage isolé par clés.

Flux de données:
1. **Authentification** → MLS crée et gère les clés de groupe via TreeKEM.
2. **Signalisation** → Les métadonnées circulent via OnionProxyService, isolées du contenu.
3. **P2P temps réel** → Messages et appels transitent en P2P chiffré; la latence est minimisée.
4. **Synchronisation** → Les données sont chiffrées côté client, synchronisées via CRDT, résolues sans conflit.
5. **Défaillance** → Fallback TURN en cas d’échec P2P; mécanismes de récupération garantissent la continuité.

## Analyse comparative des architectures (Signal, Wire, Session)

Pour ancrer les choix techniques, une analyse comparative des architectures de référence permet d’identifier les patterns pertinents et les compromis:

Tableau 1 — Comparatif Signal vs Wire vs Session

| Système | Protocole E2EE | Scalabilité groupe | Protection métadonnées | Complexité implémentation | Performance temps réel |
|---------|----------------|-------------------|------------------------|---------------------------|------------------------|
| Signal  | Double Ratchet  | Modérée (miliers)  | Pseudonymisation       | Élevée                   | Excellente             |
| Wire    | MLS + TreeKEM   | Très élevée        | Standard               | Modérée                  | Très bonne             |
| Session | Double Ratchet  | Élevée (swarm)     | Excellente (onion)     | Très élevée              | Modérée                |

Anu tire parti de chaque approche:
- De Signal: le Double Ratchet pour les échanges 1:1 et la robustesse E2EE.
- De Wire: MLS pour la scalabilité des groupes et TreeKEM pour une gestion efficace des clés.
- De Session: l’onion routing pour la protection des métadonnées et les mécanismes de swarm storage, adaptés à la signalisation d’Anu.

Cette synthèse s’appuie sur la documentation de Wire (MLS/TreeKEM), l’architecture de Session (onion routing et swarm storage), et les fondements formels des protocoles E2EE[^2][^3][^4].

## Architecture P2P temps réel

La composante P2P d’Anu s’articule autour de WebRTC, avec des optimisations de latence et une protection avancée des métadonnées réseau:

- **Signalisation WebRTC anonymisée**: séparée du contenu via OnionProxyService, assurant la confidentialité de l’IP et du timing.
- **Traversal NAT**: STUN pour découvrir les endpoints publics, TURN comme fallback chiffré, garantissant la connectivité même en environnement restrictif.
- **Optimisation codec**: Opus pour l’audio, VP8/H.264 pour la vidéo; adaptation dynamique de qualité; FEC et RTX pour la résilience.
- **Gestion de la latence**: buffers adaptatifs, contrôle de congestion, monitoring permanent des métriques réseau.

Tableau 2 — Techniques d’optimisation P2P et leur impact sur la latence

| Technique | Description | Impact latence |
|-----------|-------------|----------------|
| STUN      | Découverte d’adresse publique | Réduction 50–150 ms |
| TURN      | Relay chiffré | Surcoût 100–200 ms |
| Opus      | Codec audio optimisé | Réduction 20–50 ms |
| VP8/H.264 | Codec vidéo adaptatif | Réduction 50–100 ms |
| Buffer    | Jitter buffer adaptatif | Stabilisation 10–30 ms |

Les optimisations P2P s’inspirent des meilleures pratiques WebRTC pour minimiser la latence, en alliant codecs adaptatifs, traversal efficace et gestion des buffers[^3].

## Architecture cloud chiffré et synchronisation conflict-free

La synchronisation multi-appareils repose sur un cloud chiffré côté client, avec des CRDT assurant la cohérence forte:

- **Chiffrement côté client**: dérivé de secrets utilisateurs via HKDF; AES-256; scellés d’intégrité; clés séparées par appareil.
- **CRDT et cohérence forte**: typologie adaptée aux opérations de messagerie; convergent garantis sans mécanisme de verrou; merge basé sur ID horodaté.
- **Déploiement Redis Active-Active**: réplication multi-régions; gestion des conflits; sauvegarde chiffrée.
- **Modèles de données**: messages (CmRDT), conversations et listes (CvRDT), files d’attente; indexation chiffrée; purge automatique.

Tableau 3 — Modèles CRDT par type de données

| Type de données | CRDT recommandé | Clé de tri | Garanties | Cas d’usage |
|-----------------|-----------------|------------|-----------|-------------|
| Messages        | Operation-based CmRDT | Horodatage | Convergence sans conflit | Threads conversation |
| Listes/Groupes  | State-based CvRDT | Tri lexicographique | Évite collisions, tri stable | Listes membres, canaux |
| Files d’attente | State-based CvRDT | Priorité temps réel | Intégrité, pas de perte | Envoi asynchrone média |
| Index           | State-based CvRDT | Hash message | Index synchronisé | Recherche locale |

Tableau 4 — Schéma de stockage cloud

| Type de données | Clé cryptographique | Format | Rétention | Localisation |
|-----------------|---------------------|--------|-----------|--------------|
| Messages        | AES-256-GCM         | Protobuf | 30 jours  | EU (multi-région) |
| Médias          | AES-256-GCM + compress | WebM/MP4 | 7 jours   | EU (stockage objet) |
| Métadonnées     | AES-256-GCM         | JSON    | 90 jours  | EU (base chiffrée) |
| Logs            | AES-256-GCM         | JSON    | 7 jours   | EU (séparé, chiffré) |

Ces choix de modèles CRDT et de stockage s’inspirent des architectures de cohérence fortes et des déploiements Redis Active-Active, adaptés au chiffrement côté client[^2].

## Gestion des métadonnées et privacy-by-design

La protection des métadonnées est essentielle pour préserver la confidentialité des utilisateurs:

- **Minimisation**: collecte strictement nécessaire (timestamp, destinataire); pseudonymes par défaut; suppression systématique des logs non essentiels.
- **Anonymisation réseau**: onion routing pour l’IP; séparation des flux de signalisation et de contenu; chemins multi-sauts.
- **Patterns complémentaires**: sealed sender (contenu scellé sans exposer l’expéditeur), identité partitionnée (swarms), politiques de rétention strictes.

Tableau 5 — Inventaire des métadonnées et mesures de protection

| Métadonnée | Nécessité | Risque | Mesure de protection |
|------------|-----------|--------|---------------------|
| Timestamp  | Élevée    | Correlation | Chiffrement, agrégation |
| Destinataire | Élevée  | Profilage | Sealed sender, pseudonymes |
| IP source  | Moyenne   | Géolocalisation | Onion routing, proxy |
| Taille message | Faible  | Profilage | Padding, compression |
| Type média | Moyenne   | Inférence | Chiffrement, obfuscation |
| Logs erreurs | Faible  | Fuite info | Minimisation, purge |

Ces pratiques s’alignent sur les principes académiques de protection des métadonnées et sur l’architecture anti-métadonnées de Session[^5][^3].

## Protocoles cryptographiques et gestion des clés

La sécurité E2EE est garantie par une combinaison de protocoles éprouvés:

- **Signal Protocol (Double Ratchet)**: pour les échanges 1:1; sécurité persistante et résilience post-compromission.
- **MLS (RFC 9420) via TreeKEM**: pour les groupes; scalabilité et performance de gestion des clés; forward secrecy.
- **Chiffrement cloud**: AES-256-GCM; dérivation de clés par appareil; rotation; sauvegarde chiffrée.

Tableau 6 — Cycle de vie des clés

| Domaine | Création | Rotation | Révocation | Stockage |
|---------|----------|----------|-----------|---------|
| Signal Protocol | Échange Diffie-Helman | À chaque message | Compromise | Local chiffré |
| MLS | TreeKEM init | Join/leave members | Epoch update | Local chiffré |
| Cloud | HKDF derived | Périodique | Device loss | Local chiffré |

La gestion des clés respecte les standards de sécurité et les bonnes pratiques de l’état de l’art, en intégrant MLS pour les groupes et Signal Protocol pour les échanges 1:1[^4][^5].

## Performance et optimisation

Les objectifs de performance sont fixés pour garantir une expérience utilisateur de premier plan:

- **Latence temps réel**: objectifs < 500 ms pour messages et appels.
- **Bande passante**: adaptative pour médias; codecs optimisés; résilience (FEC/RTX).
- **Scalabilité**: P2P pour minimiser charges serveurs; cloud pour synchronisation; test de charge à 100 000 utilisateurs par groupe.
- **Optimisations**: déduplication de payloads, compression, préchargement; monitoring continu.

Tableau 7 — Budget de performance

| Métrique | Cible | Unité | Méthode de mesure | Fréquence |
|----------|-------|-------|-------------------|-----------|
| Latence message P2P | < 500 | ms | RTT WebRTC | Continue |
| Latence sync cloud | < 2000 | ms | Mesure upload/download | Continue |
| Taux échec P2P | < 5 | % | Statistiques WebRTC | Continue |
| Taille max groupe | 100 000 | Utilisateurs | Tests charge | Mensuelle |
| Disponibilité service | 99.9 | % | SLA monitoring | Continue |

Tableau 8 — Plan de tests de performance

| Scénario | Charge | KPI | Critère de succès | Outils |
|----------|--------|-----|-------------------|-------|
| Messages P2P | 1M msgs/min | Latence | < 500 ms | WebRTC stats |
| Appels A/V | 100k appels simultanés | Latence | < 500 ms | Jitter, loss |
| Sync multi-devices | 5M utilisateurs | Erreurs sync | < 0.1% | Tests CRDT |
| Groupes MLS | 100k membres | Stabilité | < 1% erreurs | Simulateur charge |
| Chute réseau | Simulée | Récupération | < 5s fallback TURN | Chaos tests |

Ces objectifs et tests s’appuient sur des benchmarks WebRTC et des optimisations de latence, alignés avec les objectifs de performance temps réel[^3].

## Stack technologique et roadmap d’implémentation

La stack recommandée reflète les exigences de sécurité, performance et scalabilité:

- **Clients mobiles**: iOS (Swift), Android (Kotlin).
- **Clients web**: TypeScript; WebRTC natif.
- **Crypto**: libsodium; implémentations MLS conformes RFC 9420.
- **Sync**: Redis Cluster (CRDT); PostgreSQL (métadonnées).
- **Signalisation P2P**: Service gRPC/TLS avec isolation métadonnées.
- **Cloud storage**: Object storage chiffré; KMS côté client; multi-régions.
- **Infrastructure**: Kubernetes; service mesh; séparation réseau; monitoring centralisé.

Tableau 9 — Roadmap par phases

| Phase | Objectifs | Livrables | Dépendances | Durée estimée | Responsable |
|-------|-----------|-----------|-------------|---------------|-------------|
| 1 — Foundations | Authentification, E2EE 1:1 | Signal Protocol, MLS initiation | Crypto libs | 3 mois | Crypto/Backend |
| 2 — P2P temps réel | WebRTC optimisé, CRDT sync | Onboarding devices, CRDT | Phase 1 | 3 mois | Mobile/Web |
| 3 — Optimisation | Scalabilité, performance | Tests charge, tuning | Phases 1–2 | 2 mois | SRE/Backend |

Tableau 10 — RACI

| Livrable | R (Responsable) | A (Comptable) | C (Consulté) | I (Informé) |
|----------|-----------------|---------------|--------------|-------------|
| Authentification MLS | Backend | CTO | Crypto | Produit |
| P2P WebRTC | Mobile | CTO | SRE | Produit |
| Cloud sync | Backend | CTO | Mobile | Produit |
| Protection métadonnées | Sécurité | CTO | Produit | SRE |
| Tests performance | SRE | CTO | Équipes dev | Produit |

La roadmap suit les recommandations d’architecture et de sécurité, en intégrant la mise en œuvre MLS et les mécanismes de synchronisation sans conflit[^2].

## Risques et mitigations

Les principaux risques sont anticipés avec des mitigations concrètes:

Tableau 11 — Registre des risques

| Risque | Probabilité | Impact | Mitigation | Propriétaire | Statut |
|--------|-------------|--------|-----------|--------------|--------|
| Latence onion routing | Élevée | Modéré | Pré-calcul routes, cache | Réseau | Ouvert |
| Complexité MLS | Modérée | Élevé | Formation, audit crypto | Crypto | Ouvert |
| Coûts TURN | Élevée | Modéré | Budgets, monitoring | SRE | Ouvert |
| Disponibilité cloud | Faible | Élevé | Multi-régions, failover | SRE | Ouvert |
| Synchronisation conflits | Faible | Modéré | CRDT robustes | Backend | Ouvert |
| Sécurité clés | Modérée | Élevé | HSM, rotation | Sécurité | Ouvert |

Ces risques sont gérés selon les bonnes pratiques de sécurité et les modèles décentralisés, avec des actions de mitigation pour préserver performance et confidentialité[^3].

## Métriques de succès et conformité

Les métriques de succès guident la validation de l’architecture:

- **Performance**: latence P2P, latence sync cloud, taux d’échec P2P.
- **Disponibilité**: objectifs 99,9% pour services critiques.
- **Sécurité**: audits crypto, tests intrusion, conformité RGPD.
- **Expérience utilisateur**: NPS, adoption fonctionnalités avancées.

Tableau 12 — KPI de succès

| KPI | Valeur cible | Méthode de mesure | Fréquence | Alerte |
|-----|--------------|-------------------|-----------|--------|
| Latence message P2P | < 500 ms | WebRTC RTT | Continue | > 700 ms |
| Latence sync cloud | < 2000 ms | Mesure réseau | Continue | > 3000 ms |
| Taux échec P2P | < 5% | Stats WebRTC | Continue | > 8% |
| Disponibilité service | 99.9% | SLA monitoring | Mensuelle | < 99.5% |
| Audit crypto | 0 critique | Rapport sécurité | Trimestrielle | N/A |

La conformité RGPD est assurée par des mécanismes de minimisation, pseudonymisation, rétention limitée et contrôle d’accès. Les métriques d’expérience utilisateurs permettent d’ajuster les optimisations et d’augmenter l’adoption des fonctionnalités avancées[^5].

## Conclusion

L’architecture hybride proposée pour Anu — P2P temps réel chiffré combiné à un cloud chiffré côté client — répond aux exigences de sécurité, performance et scalabilité. Elle s’appuie sur des protocoles éprouvés (Signal Protocol, MLS) et des mécanismes de protection des métadonnées (onion routing, sealed sender), avec une synchronisation offline-first via CRDT et une résilience multi-régions.

Les bénéfices clés incluent une latence minimale, une E2EE robuste, une cohérence forte, et une protection avancée des métadonnées. Les compromis — latence additionnelle par onion routing, complexité de MLS, coûts TURN — sont maîtrisés par des optimisations, une formation ciblée et un monitoring rigoureux.

Prochaines étapes:
- Valider l’architecture via des prototypes et tests de charge.
- Finaliser la stack et les partenariats cloud.
- Lancer le développement selon la roadmap en 3 phases.

---

## Références

[^1]: RFC 9420: Messaging Layer Security (MLS). https://www.rfc-editor.org/rfc/rfc9420
[^2]: Wire Whitepaper: End-to-End Encryption and Messaging Layer Security (MLS). https://wire.com/wp-content/uploads/2020/06/Wire-Group-E2EE-MLS-Whitepaper.pdf
[^3]: Session Whitepaper: Decentralized Messaging with Onion Routing and Storage. https://arxiv.org/pdf/2405.15968
[^4]: Formal Foundations for Secure Messaging (askarov et al.). https://askarov.net/papers/eurosp2020.pdf
[^5]: Minimisation et protection des métadonnées dans les systèmes E2EE. https://www.privacyguides.org/basics/metadata/

---

## Annexes

### A. Liste des sources additionnelles
- Redis CRDT based Active-Active: Deep Dive. https://redis.io/blog/active-active-crdts/
- Zero-Knowledge Architecture for Privacy-Preserving Systems. https://www.researchgate.net/publication/362375294
- Privacy by Design in End-to-End Encryption Systems. https://www.researchgate.net/publication/369123456
- Client-Side Encryption Patterns for Cloud Storage. https://www.cloudflare.com/learning/security/client-side-encryption/

### B. Glossaire
- E2EE (End-to-End Encryption): chiffrement de bout en bout des messages.
- CRDT (Conflict-free Replicated Data Types): structures de données répliquées garantissant la cohérence forte.
- MLS (Messaging Layer Security): protocole standardisé pour la gestion de clés de groupe.
- TreeKEM: mécanisme cryptographique de gestion des clés dans MLS.
- Double Ratchet: protocole de chiffrement avancé garantissant la sécurité persistante.
- Onion routing: technique de routage anonyme multi-sauts.
- WebRTC: protocole de communication temps réel navigateur/appareil.
- SRTP/DTLS: protocoles de chiffrement et handshake pour flux média.
- STUN/TURN: mécanismes de traversal NAT pour establishir des connexions P2P.