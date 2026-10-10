// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Passerelle Tor (WebSocket → WebSocket).
 *
 * Un navigateur ne peut pas joindre le réseau Tor directement (pas de TCP brut,
 * pas de SOCKS depuis le JS). Cette passerelle tourne sur le VPS et expose un
 * point WebSocket « clearnet » qui relaie, POUR CHAQUE connexion, une session
 * vers un relais distant **à travers Tor** (proxy SOCKS5 local).
 *
 * Résultat : le relais distant ne voit qu'une IP de sortie Tor, jamais celle de
 * l'utilisateur. Côté app, le bouton « Router via Tor » (Paramètres →
 * Confidentialité) sélectionne automatiquement `wss://<hôte-relais>/tor` : un
 * seul clic, aucun réglage utilisateur, pas de Tor Browser.
 *
 * Prérequis sur le VPS :
 *   1. Tor installé (`server/tor/setup.sh`) → SOCKS5 sur 127.0.0.1:9050.
 *   2. Un reverse proxy TLS (Caddy/Nginx) qui expose `/tor` en `wss://` vers ce
 *      processus (les pages https n'autorisent pas `ws://`).
 *   3. `npm install` dans `server/tor/`.
 *
 * Usage :
 *   TOR_UPSTREAM=wss://relais-externe.exemple/ node server/tor/gateway.mjs
 *
 * Variables :
 *   GATEWAY_PORT  port d'écoute WS local (défaut 8080, derrière le proxy TLS)
 *   GATEWAY_HOST  interface d'écoute (défaut 127.0.0.1)
 *   TOR_SOCKS     proxy SOCKS5 de Tor (défaut socks5h://127.0.0.1:9050)
 *   TOR_UPSTREAM  relais cible à joindre via Tor (obligatoire)
 *   SUBPROTOCOL   sous-protocole WS relayé (défaut simplex-smp.v4.ws)
 */

import { WebSocketServer, WebSocket } from 'ws';
import { SocksProxyAgent } from 'socks-proxy-agent';

const PORT = Number(process.env.GATEWAY_PORT || 8080);
const HOST = process.env.GATEWAY_HOST || '127.0.0.1';
const TOR_SOCKS = process.env.TOR_SOCKS || 'socks5h://127.0.0.1:9050';
const UPSTREAM = process.env.TOR_UPSTREAM;
const SUBPROTOCOL = process.env.SUBPROTOCOL || 'simplex-smp.v4.ws';

if (!UPSTREAM) {
  console.error('[tor-gateway] TOR_UPSTREAM est requis (ex. wss://relais.exemple/).');
  process.exit(1);
}

const agent = new SocksProxyAgent(TOR_SOCKS);

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  handleProtocols: protocols => (protocols.has(SUBPROTOCOL) ? SUBPROTOCOL : false),
});

wss.on('listening', () => {
  console.log(`[tor-gateway] ws://${HOST}:${PORT} → ${UPSTREAM} (via ${TOR_SOCKS})`);
});

wss.on('connection', client => {
  const upstream = new WebSocket(UPSTREAM, [SUBPROTOCOL], { agent });
  /** @type {Array<{data: Buffer|ArrayBuffer, isBinary: boolean}>} */
  const pending = [];
  let closed = false;

  const closeBoth = code => {
    if (closed) return;
    closed = true;
    try { client.close(code); } catch { /* ignore */ }
    try { upstream.close(code); } catch { /* ignore */ }
  };

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    } else if (upstream.readyState === WebSocket.CONNECTING) {
      pending.push({ data, isBinary });
    }
  });

  upstream.on('open', () => {
    for (const m of pending) upstream.send(m.data, { binary: m.isBinary });
    pending.length = 0;
  });

  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  client.on('close', () => closeBoth(1000));
  client.on('error', () => closeBoth(1011));
  upstream.on('close', () => closeBoth(1000));
  upstream.on('error', err => {
    console.error('[tor-gateway] erreur amont:', err && err.message);
    closeBoth(1011);
  });
});
