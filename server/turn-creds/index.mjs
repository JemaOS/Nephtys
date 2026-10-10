// Endpoint TURN REST API — renvoie des identifiants TURN ÉPHÉMÈRES.
// coturn est configuré en `use-auth-secret` / `static-auth-secret=PASS`.
// Ici : username = "<expiry-unix>:<id>", credential = base64(HMAC-SHA1(secret, username)).
// Le secret n'est JAMAIS exposé au client ; les creds expirent (TTL).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';

const PORT = Number(process.env.PORT || 8788);
const HOST = process.env.TURN_HOST || '78-232-3-78.sslip.io';
const TTL = Number(process.env.TURN_TTL || 3600);
const ID = process.env.TURN_ID || 'nephtys';
const RATE_MAX = Number(process.env.RATE_MAX || 30); // requêtes / fenêtre / IP
const RATE_WINDOW_MS = 60_000;
const SECRET = process.env.TURN_AUTH_SECRET
  || (process.env.TURN_AUTH_SECRET_FILE ? fs.readFileSync(process.env.TURN_AUTH_SECRET_FILE, 'utf8').trim() : '');

if (!SECRET) {
  console.error('[turn-creds] aucun secret TURN (TURN_AUTH_SECRET / TURN_AUTH_SECRET_FILE)');
  process.exit(1);
}

// ─── Rate-limit par IP (mémoire) ────────────────────────────────────────
/** @type {Map<string, number[]>} */
const hits = new Map();
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
function allow(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) {
    hits.set(ip, arr);
    return false;
  }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}
// Nettoyage périodique (borne la mémoire).
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const kept = arr.filter(t => now - t < RATE_WINDOW_MS);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref?.();

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!req.url || !req.url.startsWith('/turn')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  if (!allow(clientIp(req))) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
    res.end(JSON.stringify({ error: 'rate limited' }));
    return;
  }

  const expiry = Math.floor(Date.now() / 1000) + TTL;
  const username = `${expiry}:${ID}`;
  const credential = crypto.createHmac('sha1', SECRET).update(username).digest('base64');

  const body = JSON.stringify({
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
      {
        urls: [
          `turn:${HOST}:3478?transport=udp`,
          `turn:${HOST}:3478?transport=tcp`,
          `turns:${HOST}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    ttl: TTL,
  });

  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
});

server.listen(PORT, '127.0.0.1', () => console.log(`[turn-creds] on 127.0.0.1:${PORT} (host=${HOST}, ttl=${TTL})`));
