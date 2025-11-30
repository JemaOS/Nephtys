# Authentification sécurisée sans numéro de téléphone en 2025 : email + OAuth, pseudonymes cryptographiques et wallet-based (MetaMask, WalletConnect)

## Résumé exécutif

En 2025, les services grand public et les plateformes B2B peuvent已经达到 un palier d’ergonomie et de sécurité en matière d’authentification sans numéro de téléphone. Trois approches dominent le paysage: la connexion par email intégrée à OAuth 2.0/OpenID Connect (OIDC), l’authentification par pseudonymes associés à des clés publiques/privées (incluant WebAuthn/Passkeys), et la connexion via portefeuille crypto, communément appelée wallet-based auth, alimentée par des standards comme Sign-In With Ethereum (SIWE) et des protocoles de اتصال tels que WalletConnect. Le point commun de ces méthodes est d’éliminer le numéro de téléphone comme facteur d’authentification ou de récupération, tout en offrant une UX moderne et une compatibilité mobile solide.

Les Passkeys (FIDO2/WebAuthn) émergent comme la solution de référence pour l’authentification grand public et entreprise, grâce à leur résistance native au phishing et leur intégration ubiquitaire sur iOS, Android, Windows et macOS. Elles remplacent les mots de passe par des paires de clés asymétriques, utilisent la biométrie locale et facilitent l’authentification inter-appareils via des codes QR et des transports hybrides (CTAP + BLE), avec des gains mesurables sur les taux de connexion[^1]. Côté enterprise, les solutions de passkeys évoluent vers des plateformes complètes, combinant la suite WebAuthn, des composants UX (UI conditionnelle), l’attestation, l’intelligence des passkeys (détection des appareils et WebViews incompatibles) et des fonctionnalités de gouvernance (export de clés publiques, rétention étendue, gestion des appareils partagés). Les modèles de coûts sont désormais lisibles, avec des offres cloud publiques et privées, des add-ons avancés et des plans développeurs[^2].

La sécurité a connu une tension structurante: les attaques récentes sur le flux d’appareils OAuth (Device Flow) ont exploité la confiance hors contexte, la manipulation sociale (vishing) et l’autorisation d’applications malveillantes, conduisant à des accès persistants via des jetons OAuth et à des exfiltrations de données massives. Ces campagnes ont ciblé des organizations majeures, avec Salesforce comme point d’application privilégié et des schémas d’extraction de données très difficiles à détecter[^3]. En parallèle, des vulnérabilités critiques dans des composants d’infrastructure OAuth (CVE‑2025‑54576 sur oauth2‑proxy) ont rappelé l’importance des correctifs rapides et du durcissement de la chaîne d’authentification[^4]. Les Passkeys et l’authentification wallet-based ne souffrent pas des mêmes vecteurs, dans la mesure où elles s’appuient sur une liaison cryptographique au domaine et sur des signatures côté client.

La feuille de route recommandée converge vers un déploiement par phases: désactiver le Device Flow OAuth s’il n’est pas indispensable, mettre sous surveillance les événements OAuth et les accès API, puis déployer Passkeys en première intention pour la base d’utilisateurs, en complément des méthodes wallet-based pour les cas Web3 et communautés crypto. L’authentification par pseudonymes cryptographiques (EUDIW, OPPID, Anonymous Credentials) offre une voie prometteuse pour concilier pseudonymat et conformité (RGPD), notamment via des graines de pseudonymes (pns), des engagements (commitments) et des mécanismes de limitation d’usage. Les arbitrages se jouent entre sécurité (résistance au phishing, périmètre cryptographique, gouvernance des jetons), expérience utilisateur (friction, rapidité, résilience aux pertes de device), compatibilité mobile (WebAuthn, CTAP, SDKs) et coûts (CAPEX/OPEX, intégration, support). Les bénéfices attendus incluent une réduction des tickets de support, des taux de conversion améliorés et une posture de sécurité alignée sur NIST SP 800‑63B et les recommandations 2025 de l’EDPB[^1][^2][^3][^4].

## Cadre, périmètre et méthodologie

Cette analyse couvre les méthodes d’authentification sans numéro de téléphone déployées en 2025: email + OAuth/OIDC (avec dispositifs de gouvernance), Passkeys/WebAuthn (incluant authentification inter‑appareils et synchrpnisation), wallet-based auth (MetaMask, WalletConnect et SIWE), ainsi que les pseudonymes cryptographiques (EUDIW, OPPID, Anonymous Credentials) envisagés sous l’angle de la conformité RGPD (pseudonymisation) et des assurances d’authentification (NIST SP 800‑63‑4). Les critères d’évaluation sont la sécurité, l’UX, la compatibilité mobile, les coûts, l’adoption et la conformité.

La méthodologie s’appuie sur la documentation officielle, les analyses techniques, les avis de vulnérabilités et les guides de déploiement, ainsi que sur des synthèses de marché. Les standards FIDO2 (WebAuthn, CTAP) et les recommandations NIST SP 800‑63‑4 servent d’ancrage pour l’assurance d’authentification et les définitions de facteurs (something you know, have, are)[^5]. Les lignes directrices de l’EDPB 01/2025 sur la pseudonymisation guident la qualification RGPD des données pseudonymes et les responsabilités associées[^6].

Nous signalons plusieurs lacunes d’information qui peuvent influer sur les décisions opérationnelles: l’absence de mesures quantitatives exhaustives et comparables de conversion pour chaque méthode (email+OAuth vs Passkeys vs wallets), la couverture précises des nuances de synchronisation des passkeys par plateforme et navigateur en 2025, les statistiques d’adoption régionale de wallet‑based auth en mobile natif, et des études publiques sur la latence UX de SIWE/WalletConnect vs Passkeys en conditions réseau dégradées. Ces zones nécessitent des validations complémentaires.

## Panorama 2025 des méthodes sans numéro de téléphone

Trois familles d’authentification coexistent dans le cadre «sans numéro de téléphone»:

- Email + OAuth/OIDC: un fournisseur d’identité (Google, Apple, Microsoft, etc.) authentifie l’utilisateur, délivre un token d’accès et, via OIDC, un identifiant (subject) au service demandeur. L’absence de numéro de téléphone est possible si la récupération de compte s’appuie sur d’autres mécanismes (email, facteurs alternatifs). 

- Pseudonymes + clés publiques/privées: l’utilisateur prouve la possession d’une clé privée liée à un pseudonyme par partie de confiance (RP). WebAuthn/Passkeys généralisent ce schéma sur les appareils, en liant la paire de clés au domaine et en déléguant la vérification utilisateur à l’authentificateur local (biométrie/PIN).

- Wallet-based auth: l’utilisateur prouve le contrôle d’une adresse blockchain via signature (ex. SIWE) et authentification via un portefeuille externe (MetaMask) ou via WalletConnect. L’écosystème MetaMask propose également des «Embedded Wallets» qui combinent logins sociaux/OTP/JWT et génération non‑custodiale de portefeuille pour abaisser la friction[^7][^8].

L’adoption des Passkeys s’est accélérée, avec des bénéfices UX tangibles (processus simplifiés, gains sur les taux de connexion, authentification inter‑appareils via QR). Le marché des solutions passwordless et des plateformes enterprise (Microsoft Entra ID, Okta, JumpCloud, HYPR, Ping) traduit une maturité croissante et des modèles tarifaires plus lisibles, souvent autour de 5–15 USD/utilisateur/mois pour les offres passwordless prêtes à l’emploi[^1][^2][^9]. Côté Web3, MetaMask et WalletConnect dominent le «dernier kilomètre» de connexion et d’interopérabilité entre wallets et dApps[^7][^8][^10].

Pour illustrer la nature des arbitrages, le tableau suivant synthétise le panorama par approche.

Tableau 1 — Comparatif synthétique des approches

| Approche | Principe technique | Résistance au phishing | UX globale | Compatibilité mobile | Cas d’usage dominants |
|---|---|---|---|---|---|
| Email + OAuth/OIDC | Délégation d’authentification via IdP (OIDC), token au RP | Moyenne; dépend de l’IdP et des mesures anti‑phishing | Très familière (SSO), mais dépendance aux politiques OAuth | Élevée (Web/mobile, SDKs) | SaaS B2B/B2C, SSO avec gouvernance |
| Passkeys/WebAuthn | Paires de clés asymétriques, lien au domaine, vérification utilisateur locale | Forte (liens cryptographiques au RP) | Friction faible, +20% connexions réussies | Élevée (iOS/Android, CTAP, inter‑appareils) | Consumer/enterprise, accès sensibles |
| Wallet-based (SIWE, WalletConnect) | Signature message, vérification adresse, connexion via portefeuille | Forte si UX de signature robuste | Variable; nécessite extension/app/QR | Élevée (wallets mobiles + desktop) | dApps, communautés crypto |

Ce panorama, largement aligné sur les pratiques 2025, confirme la place centrale des Passkeys pour l’authentification sans mot de passe et la valeur des méthodes wallet‑based dans les écosystèmes Web3[^1][^2][^7][^8][^10].

## Email + OAuth/OIDC (sans SMS) : sécurité, UX et mobile

Le flux type suit OIDC: l’utilisateur est redirigé vers un fournisseur d’identité (IdP), s’authentifie, et le service reçoit un token d’identité (ID token) et/ou d’accès. L’UX est connue et s’intègre aisément aux applications mobiles et web. Toutefois, la sécurité dépend d’un ensemble de contrôles: validation stricte des métadonnées du jeton, gestion des états anti‑CSRF, restriction des scopes, rotation et révocation des jetons, gouvernance des autorisations d’applications, et surveillance des événements (consentements, accès API).

Les attaques récentes sur le Device Flow OAuth (RFC 8628) ont exploité la confiance en la demande d’autorisation: via vishing, les attaquants guident les victimes vers l’approbation d’une application malveillante, obtenant des jetons d’accès et de rafraîchissement persistants, souvent hors du champ des politiques d’accès conditionnel. La détection est délicate parce que l’activité ressemble à une API normale. La recommandation immédiate est de désactiver le Device Flow s’il n’est pas requis et de renforcer l’inventaire, l’audit et la révocation des applications OAuth autorisées[^3]. Par ailleurs, des vulnérabilités critiques dans des proxies OAuth (CVE‑2025‑54576) ont permis des contournements d’authentification, rappelant l’impératif de mise à jour et de durcissement des composants d’infrastructure[^4]. Enfin, des vulnérabilités de mécanismes OAuth bien documentées par la communauté sécurité (par ex. CSRF, confusion de paramètres, redirection开放) nécessitent une implémentation rigoureuse[^11].

Sur mobile, l’intégration se fait via SDKs, avec des bonnes pratiques: stockage sécurisé des tokens (Keychain/Keystore), durées de vie courtes, rotation des jetons de rafraîchissement, et architecture «Zero‑Trust» avec attestation d’appareil et authentification adaptative. L'objectif est d’éliminer toute dépendance au SMS tout en conservant des voies de récupération de compte robustes (email, questions de sécurité, méthodes passwordless)[^12].

Tableau 2 — Matrice de risques et contrôles (Email + OAuth/OIDC)

| Risque | Description | Contrôles techniques | Contrôles organisationnels | Indicateurs (exemples) |
|---|---|---|---|---|
| CSRF / confusion de paramètres | Redirections et états malvalidés, installation d’applications | PKCE, state/nonce, validation stricte des métadonnées IdP | Revue des implémentations, tests de pénétration | Erreurs de validation state; journaux anormaux |
| Device Flow abuse | Autorisation d’app malveillante via vishing | Désactiver Device Flow si non requis; limiter scopes | Gouvernance des apps OAuth; procédures d’escalade | Nouvelles apps avec permissions sensibles |
| Tokens persistants | Jetons de rafraîchissement non revocables | Rotation, révocation centralisée, détection d’usage anormal | Processus de révocation proactive | Jeton actif en dehors des horaires |
| Proxy auth bypass | CVE‑2025‑54576 dans oauth2‑proxy | Mise à jour, durcissement, revue config | Plan de réponse à incident | Détections SIEM sur routes skip_auth |
| Fatigue MFA | Approbations sans vérification | Appariement de numéros, prompts contextuels | Sensibilisation utilisateurs | Approbations en masse hors contexte |

Ces contrôles répondent aux faiblesses observées dans les attaques 2024‑2025, tout en tenant compte des meilleures pratiques de mise en œuvre OAuth[^3][^4][^11][^12].

## Passkeys / WebAuthn (FIDO2) : sécurité de bout en bout et compatibilité mobile

Les Passkeys reposent sur des paires de clés asymétriques associées à un compte et liées au domaine du service, avec une vérification utilisateur effectuée localement (biométrie, PIN) et des garanties fortes de confidentialité biométrique (les données ne quittent pas l’appareil). Elles confèrent une résistance au phishing en ancrant cryptographiquement la relation service‑authentificateur. Les passkeys peuvent être synchronisées entre appareils de l’utilisateur (sync) ou liées à un appareil (device‑bound); l’authentification inter‑appareils (CDA) s’effectue via CTAP et QR avec un transport hybride, permettant de signer sur un appareil secondaire tout en vérifiant la proximité physique[^1][^13]. Les passkeys remplacent avantageusement des MFA classiques (mot de passe + OTP), tant en sécurité qu’en simplicité[^1].

La compatibilité couvre iOS, Android, Windows et macOS, avec des guides enterprise pour les déploiements à grande échelle (Microsoft Entra, Okta). La stratégie «identifier‑first», l’UI conditionnelle et la gestion des WebViews incompatibles contribuent à une adoption fluide. Les solutions enterprise (ex. Corbado) offrent une suite WebAuthn complète (enregistrement, connexion, UI conditionnelle), une «passkey intelligence» (détection d’appareils et modes incrimnés), des mécanismes de protection sur appareils partagés, des rétentions et des exports de données standardisés, y compris en déploiement private cloud single‑tenant[^2][^14][^15]. Côté assurance, NIST SP 800‑63B positionne FIDO2/Passkeys au plus haut niveau d’assurance (AAL3), ce qui reflète l’immunité au phishing par liaison cryptographique et l’usage d’authentificateurs certifiés[^16].

Les coûts et délais se structurent autour d’un mix build vs buy: l’intégration en interne exige des capacités FIDO2, UX et sécurité, tandis que les offres enterprise facturent généralement 5–15 USD/utilisateur/mois, avec des plans publics/privés pour les besoins réglementaires et de résidence des données[^2][^9]. Les guides d’implémentation Passkeys mettent en avant une amélioration nette des taux de conversion et une baisse de la friction au quotidien[^17].

Tableau 3 — Compatibilité Passkeys par plateforme et capacités (2025, vue synthétique)

| Plateforme | Support Passkeys (WebAuthn) | Sync vs device‑bound | Authentification inter‑appareils (CDA) | Notes Enterprise |
|---|---|---|---|---|
| iOS | Support natif | Sync et device‑bound | Oui (QR + CTAP/BLE) | Déploiement via Entra/Okta; UI conditionnelle |
| Android | Support natif | Sync et device‑bound | Oui (QR + CTAP/BLE) | Attestation; Play Integrity; WebViews |
| Windows | Support via navigateur | Device‑bound (clés硬件) et sync | Oui | Intégration Entra ID passwordless |
| macOS | Support via navigateur | Sync et device‑bound | Oui | SSO avec Microsoft 365; politiques adaptatives |

Tableau 4 — Passkeys enterprise: coûts et fonctionnalités (extraits)

| Modèle | Prix indicatif | Fonctionnalités clés | Add‑ons |
|---|---|---|---|
| Public Cloud | ~5 000 USD/mois | Suite WebAuthn, UI conditionnelle, Passkey Intelligence, intégrations IdP | Enterprise Plus; Digital Credentials |
| Private Cloud | ~15 000 USD/mois | Single‑tenant, rétention étendue, export journalier clés publiques, protection appareils partagés | Geo‑failover, multi‑AZ, SLA personnalisé |
| Plans développeurs | Gratuit / ~149 USD/mois | Passkey‑first illimité, suppression branding, logs courts | N/A |

Ces tableaux condensent les éléments différenciants utiles aux arbitrages budgétaires et aux choix d’architecture, en phase avec les objectifs de sécurité et d’adoption[^1][^2][^9][^14][^15][^17].

## Authentification wallet‑based (MetaMask, WalletConnect, SIWE) : sécurité et UX

Le flux wallet‑based repose sur la signature d’un message (par exemple SIWE) par le portefeuille de l’utilisateur et la vérification côté serveur de l’adresse et de la signature. Avec MetaMask, la connexion s’effectue via l’extension navigateur ou l’app mobile, avec la Wallet API pour interagir de manière standardisée. WalletConnect assure l’interopérabilité entre wallets et dApps via des sessions sécurisées, des codes QR, et un large écosystème de portefeuilles supportés. L’écosystème a franchi des étapes structurantes en 2025, avec des analyses mettant en avant son rôle de «primitive» inter‑applications et sa transition vers une gouvernance décentralisée, en tant que bien public réutilisable[^7][^8][^10][^18][^19].

La sécurité des wallets dépend du contrôle des clés privées (non‑custodial vs custodial), de la robustesse des UI de signature, et de la prévention des sites phishing. L’expérience utilisateur varie: l’extension desktop est fluide, l’app mobile introduit des scans QR, et la connexion cross‑device peut demander des étapes supplémentaires. L’écosystème MetaMask propose aussi des «Embedded Wallets» qui combinent des logins sociaux/OTP/JWT avec la génération d’un portefeuille non‑custodial, réduisant la friction pour des utilisateurs non familiers avec Web3[^7]. Le paysage des wallets est vaste et diversifié, offrant des compromis en matière de sécurité (hardware wallet, Seed phrase, biométrie) et d’UX[^20]. Côté coûts, certaines opérationswap peuvent impliquer des frais (ex. MetaMask perçoit 0,875% sur les swaps et un spread sur achats fiat), mais l’authentification elle‑même n’exige pas de numéros de téléphone[^21].

Tableau 5 — Flux wallet‑based: étapes, rôles et risques/contrôles

| Étape | Acteur | Rôle | Risques | Contrôles |
|---|---|---|---|---|
| Initiation | dApp | Présente message SIWE, options wallet | Phishing UI | Domain binding, UI claire |
| Signature | Wallet | Demande signature, vérification PIN/biométrie | Fake apps | Vérif éditeur, QR verification |
| Vérification | Backend | Vérifie signature, établit session | Token misuse | Durées courtes, rotation |
| Transport | WalletConnect | Établit session cross‑device | Interception | Sessions chiffrées, audit |
| Récovery | Utilisateur | Perte device/clé | Perte accès | Plan de récupération, clés hardware |

Cette approche apporte un fort ancrage cryptographique (signature vérifiée) et s’intègre bien aux usages Web3, à condition de durcir l’UX de signature et la gouvernance des sessions[^7][^8][^10][^18][^19][^20][^21].

## Pseudonymes + clés publiques/privées : cryptographie, pseudonymisation et conformité

Les pseudonymes cryptographiques permettent d’associer un identifiant unique par RP (relying party) à un utilisateur, sans révéler son identité réelle, tout en garantissant l’adossement à un credential authentique. Dans l’architecture EUDI Wallet (EUDIW), la graine de pseudonyme (pns) est une valeur secrète par titulaire, transférable de manière sécurisée; le pseudonyme est calculé via une fonction pseudo‑aléatoire (PRF) sur un identifiant de RP et un index d’usage (nym = PRF_pns(scp||idx)). Des engagements (commitments) vers la graine (pnc) peuvent être realized via des schémas comme SHA‑256 ou Pedersen. Les mécanismes prévoient la limitation du nombre de pseudonymes par RP, la transférabilité/restauration et la distinction des attributs pseudonymes vs attestés[^22].

Des propositions comme OPPID Single Sign‑On et les Anonymous Credentials (incluant des variantes post‑quantiques) enrichissent le panel, en visant l’unobservabilité et la confidentialité tout en maintenant une compatibilité opérationnelle. OPPID formalise un SSO pseudonyme pairwise, tandis que les travaux sur l’anonymisation post‑quantique anticipent les exigences de sécurité à long terme. Ces approches répondent à des exigences RGPD: la pseudonymisation réduit la linkabilité en «définissant un domaine», mais demeure dans le champ des données personnelles, avec des obligations de sécurité et d’accountability[^6][^23][^24][^25][^26].

Tableau 6 — Cartographie des mécanismes pseudonymes

| Mécanisme | Propriétés | Garanties | Cas d’usage | Contraintes |
|---|---|---|---|---|
| EUDIW pseudonyms | pns, PRF, commitments | Uniqueness par RP, limitable via idx | Récupération de compte, anti‑bot | Transfert sécurisé de pns |
| OPPID | SSO pairwise, unobservabilité | Pseudonymat fort dans SSO | Fédérations d’entreprise | Complexité déployage |
| Anonymous Credentials | Divulgation sélective, ZKP | Confidentialité, vérification | Accès contrôlé sans KYC | Overhead crypto, intégration |
| PQ Anonymous Creds | Anticipation post‑quantique | Résilience future | Scénarios long terme | Maturité technique |

Cette cartographie montre un continuum entre «pseudonymat opérationnel» et «confidentialité forte», avec des arbitrages entre performance, complexité et conformité[^22][^23][^24][^25][^26].

## Évaluation comparative sécurité / UX / mobile / coûts

La résistance au phishing constitue le différenciateur majeur: Passkeys et wallet‑based (SIWE) offrent une immunité structurelle via liaison au domaine et signature, là où email+OAuth dépend de politiques et d’éduquer l’utilisateur contre l’ingénierie sociale (consentements, Device Flow). L’UX varie: Passkeys réduisent la friction et augmentent les taux de réussite, tandis que la connexion wallet introduce des étapes de signature et de QR. Côté mobile, les Passkeys sont ubiquitaires, les wallets sont robustes sur apps mobiles (scans QR, deep links), et OAuth reste universellement intégré.

Sur le plan des coûts, email+OAuth implique des efforts de gouvernance (inventaires, audit, surveillance), Passkeys nécessitent des intégrations UX et sécurité (avec des coûts «par utilisateur» lisibles chez les vendors), et wallet‑based implique des SDKs, des intégrations et des coûts de support UX. L’adoption passwordless est en hausse et justifiée par des gains nets en sécurité et en coûts de support[^1][^2][^9][^16][^27].

Tableau 7 — Scorecard comparatif (sécurité/UX/mobile/coûts)

| Méthode | Sécurité | UX | Mobile | Coûts |
|---|---|---|---|---|
| Email + OAuth | Moyenne; dépend contrôles et gouvernance | Haute familiarité; risque consentement | Élevée | Gouvernance, surveillance |
| Passkeys/WebAuthn | Forte (phishing‑resistant) | Friction faible; +20% réussite | Élevée | 5–15 USD/user/mo (vendors), intégrations |
| Wallet‑based | Forte (signature/domaine) | Variable (signature/QR) | Élevée | SDKs, support UX, opérations wallets |

Tableau 8 — Matrice des risques par méthode

| Méthode | Phishing | Device flow abuse | Fatigue MFA | Perte device | Exfiltration API | Contrôles principaux |
|---|---|---|---|---|---|---|
| Email + OAuth | Élevé | Élevé | Moyen | Faible | Moyen | PKCE, gouvernance apps, désactivation device flow |
| Passkeys | Faible | Faible | Faible | Moyen | Faible | Sync vs device‑bound, récupération, attestation |
| Wallet‑based | Faible | Faible | Faible | Moyen | Faible | UI signature, rotation session, vérification domaine |

Les Passkeys obtiennent le meilleur profil de sécurité‑UX, avec un coût prévisible; l’email+OAuth requiert une gouvernance stricte; wallet‑based est puissant dans les écosystèmes Web3, mais demande une UX soignée[^1][^2][^3][^9][^16][^27].

## Recommandations par cas d’usage

Consumer/Web3. Privilégier Passkeys comme méthode principale et proposer une alternative wallet‑based (MetaMask, WalletConnect, SIWE) pour les communautés crypto. Fournir un parcours de récupération robuste (device‑bound + clés hardware en option) et optimiser l’UI (identifier‑first, UI conditionnelle, messages contextuels par OS). Éviter absolument le Device Flow OAuth. Durcir la signature de messages et le domain binding[^1][^2][^7].

SaaS B2B. Intégrer Passkeys dans le SIEM/SOAR, avec gouvernance des autorisations OAuth, inventaire des apps et surveillance en temps réel. Désactiver le Device Flow s’il n’est pas requis. Surveiller les accès API, corréler les journaux d’IdP et les flux applicatifs. Planifier un déploiement par phases: MFA resistant au phishing (Passkeys) pour utilisateurs à haut risque, puis généralisation; aligner les politiques sur NIST SP 800‑63‑63B et les référentiels PCI/CMMC lorsque pertinents[^3][^16][^28][^29].

Mobile natif. Combiner Passkeys, attestation d’appareil et stockage sécurisé (Keychain/Keystore) avec authentification adaptative. Implémenter certificate pinning, liaisons d’appareil et politiques Zero‑Trust. Mettre en place des tokens courts et une rotation des refresh tokens. Favoriser l’UI conditionnelle et les parcours sans friction (identifier‑first)[^12].

Conformité & gouvernance. Appliquer la pseudonymisation selon EDPB 01/2025: maintenir les engagements (commitments), la traçabilité des pseudonymes et des politiques de limitation; clarifier les distinctions entre anonymisation et pseudonymisation; définir des plans de réponse et d’audit adaptés (SIEM, exports de clés publiques, rétentions)[^6].

Tableau 9 — Feuille de route de déploiement par phases

| Horizon | Actions clés | Indicateurs (exemples) |
|---|---|---|
| 0–3 mois | Inventaire OAuth; désactivation Device Flow; surveillance consentement/apps | Apps orphelines révoquées; baisse événements suspects |
| 3–9 mois | Déploiement Passkeys pour segments à risque; gouvernance wallets; attestation mobile | Diminution incidents; adoption passkeys par segment |
| 9–18 mois | Généralisation Passkeys; pseudonymisation RGPD; exports/portabilité clés publiques | Conformité EDPB; réduction tickets support |

Ces recommandations créent une trajectoire pragmatique et actionnable, alignée sur les menaces observées et les capacités technologiques de 2025[^1][^2][^3][^6][^12][^16].

## Feuille de route d’implémentation (90–180 jours) et conformité

La feuille de route opérationnelle se décompose en phases:

- Phase 1 (0–90 jours). Cartographier les intégrations OAuth, auditer les autorisations d’applications, désactiver le Device Flow si non requis, renforcer la surveillance (consentements, usages API), et préparer l’UX Passkeys (identifier‑first, UI conditionnelle). 

- Phase 2 (90–180 jours). Déployer Passkeys pour les segments à risque (administrateurs, accès sensibles), intégrer les solutions enterprise (Corbado, Microsoft Entra, Okta) et implémenter des plans de récupération (device‑bound + clés hardware). 

- Phase 3 (post‑180 jours). Étendre à l’ensemble des utilisateurs, mettre en œuvre la pseudonymisation RGPD (pns, commitments), exporter les clés publiques WebAuthn et aligner les journaux d’audit, rétention et portabilité. 

Le maintien en conditions opérationnelles intègre la veille sur CVE (ex. oauth2‑proxy), la mise à jour des SDKs et des politiques de sécurité, et la documentation de la conformité (NIST SP 800‑63B; PCI DSS; CMMC; HIPAA; EDPB). Les solutions de Passkeys en mode private cloud facilitent l’export standardisé des clés publiques, la rétention étendue et l’isolation des données[^4][^5][^2].

## Perspectives 2025–2027 et risques émergents

Plusieurs tendances structurantes se dégagent:

- Amélioration de l’UX Passkeys: synchronisation cross‑device plus robuste, UI conditionnelle plus contextuelle, détection proactive des incompatibilités (WebViews, Incognito), optimisation des parcours «identifier‑first»[^2].

- Passkeys + Verified Credentials: convergence vers des identités vérifiables interopérables, combinant WebAuthn et des credentials mobiles (mDL, EUDI), avec une armonisation FIDO sur l’écosystème[^30].

- Maturation WalletConnect: accélération de l’adoption et du rôle de primitive interopérable, gouvernance décentralisée, intégration plus fluide des parcours cross‑device et des dApps multi‑chaînes[^10].

- Sécurité post‑quantique: avancées sur les Anonymous Credentials PQ, anticipant le besoin de résilience à long terme, en parallèle d’un renforcement continu des contrôles Zero‑Trust et de l’analyse comportementale sur les événements d’identité[^24].

Les risques à surveiller incluent l'évolution des attaques de phishing (usurpation d’UI, deepfakes vocaux), la dépendance toujours présente à l’email ( Spear phishing et récupération), la perte d’appareils sans mécanismes de récupération robustes, et les erreurs de configuration dans les intégrations OAuth. L’architecture doit intégrer ces inconnues via des contrôles adaptatifs, une surveillance en temps réel, et des procédures de récupération sécurisées[^24][^30][^10].

## Annexes

Glossaire (extraits). WebAuthn (API navigateur pour l’authentification par clés publiques), CTAP (Client‑to‑Authenticator Protocol, transporte entre client et authentificateur), Passkeys (identifiants FIDO synchronisés ou liés à l’appareil), SIWE (Sign‑In With Ethereum, protocole de signature pour l’authentification), WalletConnect (protocole de session et de transport entre wallets et dApps), Pseudonymisation (EDPB, technique de réduction de linkabilité dans un domaine défini)[^1][^31][^5].

Checklist sécurité OAuth (extraits). Implémentation PKCE et state/nonce; inventaire et audit des autorisations d’applications; rotation et révocation de tokens; surveillance en temps réel; désactivation du Device Flow si non requis; mise à jour des composants (CVE‑2025‑54576)[^11][^3][^4][^32][^33].

Checklist Passkeys (extraits). UI conditionnelle; parcours «identifier‑first»; recovery plan (device‑bound + clés hardware); passkey intelligence (détection appareils et WebViews); attestation d’appareil; gouvernance des appareils partagés; rétention et export de données; alignement NIST SP 800‑63B[^1][^2][^16][^15].

Ressources pratiques. Passkey Central (guides UX et bonnes pratiques), documentation FIDO2/WebAuthn, guides enterprise Microsoft/Okta, documentation MetaMask/WalletConnect, white paper FIDO sur les credentials vérifiables[^31][^1][^14][^15][^7][^8][^30].

---

## Références

[^1]: FIDO Alliance. FIDO Passkeys: Passwordless Authentication. https://fidoalliance.org/passkeys/

[^2]: Corbado. Pricing – Enterprise-Grade Passkey Solution. https://www.corbado.com/pricing

[^3]: Security Boulevard. OAuth Device Flow Vulnerabilities: A Critical Analysis of the 2024-2025 Attack Wave. https://securityboulevard.com/2025/08/oauth-device-flow-vulnerabilities-a-critical-analysis-of-the-2024-2025-attack-wave/

[^4]: ZeroPath. CVE-2025-54576: OAuth2-Proxy Auth Bypass – Brief Summary. https://zeropath.com/blog/cve-2025-54576-oauth2-proxy-auth-bypass

[^5]: NIST. SP 800-63-4 Digital Identity Guidelines. https://pages.nist.gov/800-63-4/sp800-63.html

[^6]: EDPB. Guidelines 01/2025 on Pseudonymisation. https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf

[^7]: MetaMask Docs. Authentication (Embedded Wallets). https://docs.metamask.io/embedded-wallets/authentication/

[^8]: MetaMask Docs. Wallet API Introduction. https://docs.metamask.io/wallet/

[^9]: JumpCloud. Top Enterprise-Ready Passwordless Authentication Tools (2025/2026). https://jumpcloud.com/blog/enterprise-passwordless-authentication-tools

[^10]: Forbes. The Last Mile in Web3: The Example of WalletConnect (2025). https://www.forbes.com/sites/vipinbharathan/2025/10/06/the-last-mile-in-web3-the-example-of-walletconnect/

[^11]: PortSwigger. OAuth 2.0 authentication vulnerabilities. https://portswigger.net/web-security/oauth

[^12]: NextNative. 8 Mobile Authentication Best Practices for 2025. https://nextnative.dev/blog/mobile-authentication-best-practices

[^13]: Authgear. Passkeys Compatibility: Which Platforms Support… https://authgear.com/post/passkeys-compatibility

[^14]: Microsoft Learn. Enable passkeys (FIDO2) for your organization. https://learn.microsoft.com/en-us/entra/identity/authentication/how-to-enable-passkey-fido2

[^15]: Okta. Configure the FIDO2 (WebAuthn) authenticator | Okta Identity Engine. https://help.okta.com/oie/en-us/content/topics/identity-engine/authenticators/configure-webauthn.htm

[^16]: CIT Solutions. Which MFA Type is Most Secure? A Definitive 2025 Ranking. https://www.citsolutions.net/which-mfa-type-is-most-secure-a-definitive-2025-ranking/

[^17]: Security Boulevard. Complete Guide to Passkeys: Implementation, Benefits & Best Practices (2025). https://securityboulevard.com/2025/09/complete-guide-to-passkeys-implementation-benefits-best-practices/

[^18]: Alchemy. The 15 Best Web3 Wallets for 2025. https://www.alchemy.com/overviews/web3-wallets

[^19]: MetaMask. The Leading Crypto Wallet Platform. https://metamask.io/

[^20]: The Defiant. Best Decentralized Crypto Wallets Reviewed for 2025. https://www.coinspeaker.com/guides/best-decentralized-crypto-wallets/

[^21]: CryptoNews. Best Wallet vs MetaMask: Comparison 2025. https://cryptonews.com/cryptocurrency/best-wallet-vs-metamask/

[^22]: arXiv. A Brief Note on Cryptographic Pseudonyms for Anonymous Authentication (EUDIW). https://arxiv.org/html/2510.05419v1

[^23]: PoPETs 2025. OPPID: Single Sign-On with Oblivious Pairwise Pseudonyms. https://petsymposium.org/popets/2025/popets-2025-0080.pdf

[^24]: Cloudflare. Policy, privacy and post-quantum: anonymous credentials. https://blog.cloudflare.com/pq-anonymous-credentials/

[^25]: UCL. Anonymisation and Pseudonymisation of Personal Data (2025 guidance). https://www.ucl.ac.uk/data-protection/guidance-staff-students-and-researchers/practical-data-protection-guidance-notices/anonymisation-and

[^26]: GDPR Local. Data Pseudonymisation vs Anonymisation: Key Differences. https://gdprlocal.com/data-pseudonymisation-vs-anonymisation/

[^27]: JumpCloud. Passwordless Authentication Adoption Trends in 2025. https://jumpcloud.com/blog/passwordless-authentication-adoption-trends

[^28]: PCI Security Standards Council. PCI DSS. https://www.pcisecuritystandards.org/

[^29]: U.S. DoD. CMMC. https://dodcio.defense.gov/CMMC/

[^30]: FIDO Alliance. Passkeys and Verifiable Digital Credentials: A Harmonized Path. https://fidoalliance.org/passkeys-and-verifiable-digital-credentials-a-harmonized-path-to-secure-digital-identity/

[^31]: Passkey Central. Passkeys Resources and Design Guidelines. https://www.passkeycentral.org/

[^32]: SOCRadar. OAuth2-Proxy CVE-2025-54576 Bypass Authentication. https://socradar.io/oauth2-proxy-cve-2025-54576-bypass-authentication/

[^33]: Proofpoint. Microsoft OAuth App Impersonation Campaign Leads to MFA Phishing. https://www.proofpoint.com/us/blog/threat-insight/microsoft-oauth-app-impersonation-campaign-leads-mfa-phishing

[^34]: Duo Security (Cisco). WebAuthn, Passwordless and FIDO2 Explained. https://duo.com/blog/webauthn-passwordless-fido2-explained-componens-passwordless-architecture

[^35]: webauthn.me. WebAuthn and Passkeys. https://www.webauthn.me/passkeys