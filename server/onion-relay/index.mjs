// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Relais HTTP `.onion` — expose les endpoints consommés par le transport Tor
 * WASM du navigateur (`torSmpTransport`) et par le transfert XFTP sous Tor.
 *
 * Pourquoi un relais HTTP et pas un WebSocket ?
 *   Le client Tor embarqué (`tor-js`, Arti/WASM) ne sait faire que du `fetch`
 *   HTTP **à travers Tor** — il ne peut pas ouvrir de WebSocket. Le transport
 *   SMP-over-Tor encapsule donc les trames WebSocket binaires (blocs SMP de
 *   16384 o) dans deux endpoints HTTP :
 *     • `POST /smp/up?sessionId=…`   : le client dépose une (ou quelques) trame(s)
 *       encadrée(s) par une longueur 4 o (big-endian) ; le relais défait
 *       l'encadrement et écrit chaque trame vers la connexion WebSocket amont.
 *     • `GET  /smp/down?sessionId=…` : réponse **streamée** ; le relais ré-encadre
 *       chaque message binaire reçu de l'amont (4 o de longueur) et le pousse au
 *       client.
 *   Le `sessionId` (UUID généré par le socket fantôme) corrèle le flux montant
 *   et le flux descendant d'une même connexion logique.
 *
 * Amont (logique de files existante) :
 *   `UPSTREAM_WS` est la connexion WebSocket que ce relais ouvre **par session**.
 *   Par défaut : `ws://127.0.0.1:8090` = le relais de files auto-hébergé
 *   (`server/relay.mjs`, qui est la logique de files `RelayCore`). Le relais HTTP
 *   est **transparent** : il ne regarde jamais le contenu des trames (ciphertext
 *   E2EE). Il relaie la file existante sans la modifier.
 *
 * Exposition en service `.onion` (Tor HiddenService) :
 *   Sur l'hôte du relais, avec Tor installé :
 *     # /etc/tor/torrc
 *     HiddenServiceDir  /var/lib/tor/nephtys-relay/
 *     HiddenServicePort 80 127.0.0.1:8091
 *   Puis `systemctl restart tor` : Tor écrit l'adresse dans
 *   `/var/lib/tor/nephtys-relay/hostname` (ex. `abcd…xyz.onion`). Côté app,
 *   renseigner cette adresse comme **adresse `.onion` du relais** (Paramètres →
 *   Confidentialité → « Adresse `.onion` ») : `torClient` en dérive
 *   `http://<…>.onion/smp/up|down`.
 *
 * Anti-abus (aucune authentification : le secret EST le `sessionId` opaque) :
 *   • taille de corps bornée sur `/smp/up` (MAX_UP_BODY_BYTES) + nb de trames
 *     borné (MAX_FRAMES_PER_POST) ;
 *   • rate-limit par IP (fenêtre glissante) sur toutes les routes ;
 *   • plafond de sessions simultanées (MAX_SESSIONS) + éviction des sessions
 *     inactives (SESSION_TTL_MS) ;
 *   • tampon descendant borné (MAX_BUFFERED_DOWN) : un client lent fait tomber
 *     sa propre session, pas le relais ;
 *   • `/xftp` n'est **pas** un proxy ouvert : liste blanche d'hôtes
 *     (XFTP_ALLOWED_HOSTS), ports 1..65535.
 *   • idempotence : un même `sessionId` réutilise la même connexion amont ; un
 *     nouveau `GET /smp/down` remplace l'ancien flux (pas de fan-out).
 *
 * Démarrage :
 *   node server/onion-relay/index.mjs
 *
 * Variables : ONION_RELAY_HOST, ONION_RELAY_PORT, UPSTREAM_WS,
 *   UPSTREAM_OPEN_TIMEOUT_MS, MAX_SESSIONS, SESSION_TTL_MS, MAX_UP_BODY_BYTES,
 *   MAX_FRAMES_PER_POST, MAX_BUFFERED_DOWN, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS,
 *   HTTP_REQUEST_TIMEOUT_MS, XFTP_ALLOWED_HOSTS, XFTP_REQUEST_TIMEOUT_MS.
 *
 * Aucune dépendance externe : `node:http`, `node:stream`, `fetch` et `WebSocket`
 * globaux (Node ≥ 22).
 */

import http from 'node:http';
import { Readable } from 'node:stream';

const HOST = process.env.ONION_RELAY_HOST || '127.0.0.1';
const PORT = Number(process.env.ONION_RELAY_PORT || 8091);
const UPSTREAM_WS = process.env.UPSTREAM_WS || 'ws://127.0.0.1:8090';
const UPSTREAM_OPEN_TIMEOUT_MS = Number(process.env.UPSTREAM_OPEN_TIMEOUT_MS || 15000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS || 512);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 120000);
const MAX_UP_BODY_BYTES = Number(process.env.MAX_UP_BODY_BYTES || 64 * 1024);
const MAX_FRAMES_PER_POST = Number(process.env.MAX_FRAMES_PER_POST || 8);
const MAX_BUFFERED_DOWN = Number(process.env.MAX_BUFFERED_DOWN || 256);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 600);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const HTTP_REQUEST_TIMEOUT_MS = Number(process.env.HTTP_REQUEST_TIMEOUT_MS || 600000);
const XFTP_ALLOWED_HOSTS = (process.env.XFTP_ALLOWED_HOSTS || 'simplex.im')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);
const XFTP_REQUEST_TIMEOUT_MS = Number(process.env.XFTP_REQUEST_TIMEOUT_MS || 120000);

const SESSION_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/;

if (typeof WebSocket !== 'function') {
  console.error('[onion-relay] WebSocket global absent : Node ≥ 22 requis.');
  process.exit(1);
}

/** @type {Map<string, Session>} */
const sessions = new Map();
/** @type {Map<string, {count:number, resetAt:number}>} */
const rate = new Map();

function nowMs() {
  return Date.now();
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

/** Consomme (et jette) le corps d'une requête refusée, pour libérer le socket. */
function drain(req) {
  req.resume();
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function allowRate(ip) {
  const t = nowMs();
  let entry = rate.get(ip);
  if (!entry || entry.resetAt <= t) {
    entry = { count: 0, resetAt: t + RATE_LIMIT_WINDOW_MS };
    rate.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT_MAX;
}

function hostAllowed(host) {
  if (!host) return false;
  return XFTP_ALLOWED_HOSTS.some(suffix => host === suffix || host.endsWith('.' + suffix));
}

// ─── Encadrement des trames (4 o de longueur, big-endian) ────────────

function frameBlock(block) {
  const n = block.length;
  const out = new Uint8Array(4 + n);
  out[0] = (n >>> 24) & 0xff;
  out[1] = (n >>> 16) & 0xff;
  out[2] = (n >>> 8) & 0xff;
  out[3] = n & 0xff;
  out.set(block, 4);
  return out;
}

/** Découpe un corps encadré en trames complètes (ignore une trame partielle). */
function parseFrames(body) {
  const frames = [];
  let offset = 0;
  while (body.length - offset >= 4) {
    const len =
      (body[offset] << 24) | (body[offset + 1] << 16) | (body[offset + 2] << 8) | body[offset + 3];
    if (len < 0 || body.length - offset - 4 < len) break;
    frames.push(body.subarray(offset + 4, offset + 4 + len));
    offset += 4 + len;
  }
  return frames;
}

/** Lit un corps borné ; lève `{ code: 413 }` au-delà de `limit`. */
function readBounded(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        // On n'accumule plus et on met le flux en pause : l'appelant répond 413
        // puis détruit le socket (sinon la réponse serait coupée par le RST).
        chunks.length = 0;
        req.pause();
        reject(Object.assign(new Error('body too large'), { code: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    req.on('error', error => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

// ─── Sessions (1 connexion amont WebSocket par sessionId) ────────────

/**
 * @typedef {{
 *   id: string,
 *   ws: WebSocket|null,
 *   wsReady: boolean,
 *   wsFailed: boolean,
 *   openPromise: Promise<void>|null,
 *   downRes: import('node:http').ServerResponse|null,
 *   downBuffer: Uint8Array[],
 *   lastSeen: number,
 * }} Session
 */

function makeSession(id) {
  /** @type {Session} */
  const session = {
    id,
    ws: null,
    wsReady: false,
    wsFailed: false,
    openPromise: null,
    downRes: null,
    downBuffer: [],
    lastSeen: nowMs(),
  };
  openUpstream(session);
  return session;
}

function openUpstream(session) {
  let resolveOpen;
  let rejectOpen;
  session.openPromise = new Promise((resolve, reject) => {
    resolveOpen = resolve;
    rejectOpen = reject;
  });
  // Évite un rejet non capté si personne n'attend la promesse.
  session.openPromise.catch(() => {});

  let ws;
  try {
    ws = new WebSocket(UPSTREAM_WS);
  } catch {
    session.wsFailed = true;
    rejectOpen(new Error('upstream construct failed'));
    return;
  }
  session.ws = ws;
  ws.binaryType = 'arraybuffer';

  const timer = setTimeout(() => {
    if (!session.wsReady) {
      session.wsFailed = true;
      try { ws.close(); } catch { /* ignore */ }
      rejectOpen(new Error('upstream open timeout'));
    }
  }, UPSTREAM_OPEN_TIMEOUT_MS);

  ws.addEventListener('open', () => {
    clearTimeout(timer);
    session.wsReady = true;
    resolveOpen();
  });
  ws.addEventListener('message', event => {
    void onUpstreamMessage(session, event.data);
  });
  ws.addEventListener('close', () => {
    clearTimeout(timer);
    session.wsFailed = true;
    rejectOpen(new Error('upstream closed'));
    onUpstreamClosed(session);
  });
  ws.addEventListener('error', () => {
    clearTimeout(timer);
    session.wsFailed = true;
    rejectOpen(new Error('upstream error'));
  });
}

async function ensureUpstreamOpen(session) {
  if (session.wsReady) return true;
  if (session.wsFailed) return false;
  if (!session.openPromise) return false;
  try {
    await session.openPromise;
    return session.wsReady;
  } catch {
    return false;
  }
}

async function onUpstreamMessage(session, data) {
  let bytes = null;
  if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  else if (typeof Blob !== 'undefined' && data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
  else if (typeof data === 'string') bytes = new TextEncoder().encode(data);
  if (!bytes || !bytes.length) return;
  session.lastSeen = nowMs();
  pushDown(session, bytes);
}

function pushDown(session, block) {
  const framed = frameBlock(block);
  const res = session.downRes;
  if (res && !res.writableEnded) {
    try {
      res.write(Buffer.from(framed));
    } catch {
      session.downRes = null;
    }
    return;
  }
  if (session.downBuffer.length >= MAX_BUFFERED_DOWN) session.downBuffer.shift();
  session.downBuffer.push(framed);
}

function onUpstreamClosed(session) {
  if (session.downRes && !session.downRes.writableEnded) {
    try { session.downRes.end(); } catch { /* ignore */ }
  }
  session.downRes = null;
  if (sessions.get(session.id) === session) sessions.delete(session.id);
}

function getOrCreateSession(id) {
  const existing = sessions.get(id);
  if (existing) {
    existing.lastSeen = nowMs();
    return existing;
  }
  if (sessions.size >= MAX_SESSIONS) return null;
  const session = makeSession(id);
  sessions.set(id, session);
  return session;
}

// ─── Handlers ────────────────────────────────────────────────────────

async function handleUp(req, res, url) {
  const id = url.searchParams.get('sessionId') || '';
  if (!SESSION_ID_RE.test(id)) {
    drain(req);
    sendJson(res, 400, { error: 'sessionId invalide' });
    return;
  }
  const session = getOrCreateSession(id);
  if (!session) {
    drain(req);
    sendJson(res, 503, { error: 'capacité de sessions atteinte' });
    return;
  }
  let body;
  try {
    body = await readBounded(req, MAX_UP_BODY_BYTES);
  } catch {
    sendJson(res, 413, { error: 'corps trop volumineux' });
    // Ferme le socket APRÈS l'envoi de la réponse (le corps non lu est jeté).
    res.on('finish', () => { try { req.destroy(); } catch { /* ignore */ } });
    return;
  }
  const frames = parseFrames(body);
  if (!frames.length) {
    sendJson(res, 202, { ok: true, frames: 0 });
    return;
  }
  if (frames.length > MAX_FRAMES_PER_POST) {
    sendJson(res, 413, { error: 'trop de trames' });
    return;
  }
  if (!(await ensureUpstreamOpen(session))) {
    sendJson(res, 502, { error: 'relais amont injoignable' });
    return;
  }
  session.lastSeen = nowMs();
  try {
    for (const frame of frames) session.ws.send(frame);
  } catch {
    sendJson(res, 502, { error: 'envoi amont échoué' });
    return;
  }
  sendJson(res, 202, { ok: true, frames: frames.length });
}

async function handleDown(req, res, url) {
  const id = url.searchParams.get('sessionId') || '';
  if (!SESSION_ID_RE.test(id)) {
    sendJson(res, 400, { error: 'sessionId invalide' });
    return;
  }
  const session = getOrCreateSession(id);
  if (!session) {
    sendJson(res, 503, { error: 'capacité de sessions atteinte' });
    return;
  }
  if (!(await ensureUpstreamOpen(session))) {
    sendJson(res, 502, { error: 'relais amont injoignable' });
    return;
  }
  // Idempotence : un nouveau GET remplace l'ancien flux (pas de fan-out).
  if (session.downRes && !session.downRes.writableEnded) {
    try { session.downRes.end(); } catch { /* ignore */ }
  }
  session.lastSeen = nowMs();
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.setTimeout(0);
  session.downRes = res;
  for (const buffered of session.downBuffer.splice(0)) {
    try { res.write(Buffer.from(buffered)); } catch { break; }
  }
  req.on('close', () => {
    session.lastSeen = nowMs();
    if (session.downRes === res) session.downRes = null;
  });
}

async function handleXftp(req, res, url) {
  const host = (url.searchParams.get('host') || '').trim().toLowerCase();
  const port = Number(url.searchParams.get('port') || 443);
  if (!hostAllowed(host)) {
    drain(req);
    sendJson(res, 403, { error: 'hôte XFTP non autorisé' });
    return;
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    drain(req);
    sendJson(res, 400, { error: 'port invalide' });
    return;
  }
  const rawPath = typeof req.headers['x-xftp-path'] === 'string' ? req.headers['x-xftp-path'] : '/';
  const safePath = rawPath.startsWith('/') ? rawPath : '/';
  const target = `https://${host}${port === 443 ? '' : ':' + port}${safePath}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XFTP_REQUEST_TIMEOUT_MS);
  try {
    const headers = {};
    if (typeof req.headers['content-type'] === 'string') headers['content-type'] = req.headers['content-type'];
    headers['accept'] = typeof req.headers['accept'] === 'string' ? req.headers['accept'] : 'application/octet-stream';
    const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req : undefined,
      duplex: hasBody ? 'half' : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });
    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    res.writeHead(upstream.status, {
      'content-type': contentType,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch {
    if (!res.headersSent) sendJson(res, 502, { error: 'amont XFTP injoignable' });
    else {
      try { res.end(); } catch { /* ignore */ }
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Serveur + maintenance ───────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (!allowRate(clientIp(req))) {
    drain(req);
    sendJson(res, 429, { error: 'trop de requêtes' });
    return;
  }
  let url;
  try {
    url = new URL(req.url || '/', 'http://localhost');
  } catch {
    drain(req);
    sendJson(res, 400, { error: 'URL invalide' });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true, sessions: sessions.size });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/smp/down') {
    void handleDown(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/smp/up') {
    void handleUp(req, res, url);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/xftp') {
    void handleXftp(req, res, url);
    return;
  }
  drain(req);
  sendJson(res, 404, { error: 'not found' });
});

server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

const reaper = setInterval(() => {
  const cutoff = nowMs() - SESSION_TTL_MS;
  for (const [id, session] of sessions) {
    if (session.lastSeen < cutoff && session.downRes === null) {
      try { session.ws?.close(); } catch { /* ignore */ }
      sessions.delete(id);
    }
  }
  const rateCutoff = nowMs();
  for (const [ip, entry] of rate) {
    if (entry.resetAt <= rateCutoff) rate.delete(ip);
  }
}, 30000);
reaper.unref?.();

server.listen(PORT, HOST, () => {
  console.log(
    `[onion-relay] http://${HOST}:${PORT} → ${UPSTREAM_WS} ` +
    `(sessions max=${MAX_SESSIONS}, xftp hosts=${XFTP_ALLOWED_HOSTS.join('|') || 'none'})`,
  );
});
