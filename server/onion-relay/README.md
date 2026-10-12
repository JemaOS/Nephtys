# Relais HTTP `.onion` (transport Tor WASM + XFTP)

Composant serveur qui rend le mode Tor réellement fonctionnel : le client Tor
embarqué (`tor-js`) ne sait faire que du `fetch` HTTP à travers Tor, pas de
WebSocket. Ce relais expose donc en HTTP les deux flux d'une connexion SMP, plus
un tunnel XFTP.

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| `POST` | `/smp/up?sessionId=…` | Dépose une (ou quelques) trame(s) encadrée(s) par une longueur 4 o (big-endian) ; chaque trame est écrite vers la connexion WebSocket amont. |
| `GET`  | `/smp/down?sessionId=…` | Réponse **streamée** : chaque message binaire amont est ré-encadré (4 o de longueur) et poussé au client. |
| `POST` | `/xftp?host=…&port=…` | Tunnel HTTP→HTTPS vers un serveur XFTP **autorisé** (liste blanche). Utilisé par le client XFTP sous Tor. |
| `GET`  | `/healthz` | Diagnostic JSON. |

Le `sessionId` (UUID généré par le socket fantôme client) corrèle le flux
montant et descendant d'une même connexion logique. Aucune authentification : le
secret **est** ce `sessionId` opaque.

## Amont (logique de files existante)

`UPSTREAM_WS` (défaut `ws://127.0.0.1:8090`) est la connexion WebSocket ouverte
**par session** ; par défaut, le relais de files auto-hébergé
(`server/relay.mjs`, logique `RelayCore`). Le relais HTTP est transparent : il ne
regarde jamais le contenu des trames (ciphertext E2EE).

## Démarrage

```bash
node server/onion-relay/index.mjs
# ou
ONION_RELAY_PORT=8091 UPSTREAM_WS=ws://127.0.0.1:8090 node server/onion-relay/index.mjs
```

Node ≥ 22 (utilise `fetch` et `WebSocket` globaux) ; aucune dépendance externe.

## Exposition en service `.onion` (Tor HiddenService)

Sur l'hôte du relais, Tor installé :

```conf
# /etc/tor/torrc
HiddenServiceDir  /var/lib/tor/nephtys-relay/
HiddenServicePort 80 127.0.0.1:8091
```

```bash
sudo systemctl restart tor
sudo cat /var/lib/tor/nephtys-relay/hostname   # → abcd…xyz.onion
```

Côté application : renseigner cette adresse comme **adresse `.onion` du relais**
(Paramètres → Confidentialité → « Adresse `.onion` »). `torClient` en dérive
`http://<…>.onion/smp/up|down` ; le mode Tor refuse de démarrer sans `.onion`
(fail-closed, aucun repli vers le relais clearnet de l'opérateur).

## Variables

| Variable | Défaut | Rôle |
|---|---|---|
| `ONION_RELAY_HOST` | `127.0.0.1` | Interface d'écoute locale (derrière le HiddenService). |
| `ONION_RELAY_PORT` | `8091` | Port d'écoute local. |
| `UPSTREAM_WS` | `ws://127.0.0.1:8090` | Relais de files amont (WebSocket). |
| `UPSTREAM_OPEN_TIMEOUT_MS` | `15000` | Délai d'ouverture de l'amont. |
| `MAX_SESSIONS` | `512` | Plafond de sessions simultanées. |
| `SESSION_TTL_MS` | `120000` | Éviction des sessions inactives. |
| `MAX_UP_BODY_BYTES` | `65536` | Borne du corps de `/smp/up`. |
| `MAX_FRAMES_PER_POST` | `8` | Borne du nombre de trames par POST. |
| `MAX_BUFFERED_DOWN` | `256` | Tampon descendant borné (client lent). |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `600` / `60000` | Rate-limit par IP. |
| `HTTP_REQUEST_TIMEOUT_MS` | `600000` | Délai de réception de requête. |
| `XFTP_ALLOWED_HOSTS` | `simplex.im` | Suffixes d'hôtes XFTP autorisés. |
| `XFTP_REQUEST_TIMEOUT_MS` | `120000` | Délai du tunnel XFTP. |

## Garde-fous anti-abus

Aucune authentification (le secret est le `sessionId`), d'où des bornes
explicites : taille de corps et nombre de trames bornés, rate-limit par IP,
plafond de sessions + éviction par inactivité, tampon descendant borné (un client
lent fait tomber sa session, pas le relais), `/xftp` restreint par liste blanche
(pas de proxy ouvert), et idempotence (un `sessionId` réutilise la même
connexion amont ; un nouveau `GET /smp/down` remplace l'ancien flux).
