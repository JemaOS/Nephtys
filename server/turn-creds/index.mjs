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
const SECRET = process.env.TURN_AUTH_SECRET
  || (process.env.TURN_AUTH_SECRET_FILE ? fs.readFileSync(process.env.TURN_AUTH_SECRET_FILE, 'utf8').trim() : '');

if (!SECRET) {
  console.error('[turn-creds] aucun secret TURN (TURN_AUTH_SECRET / TURN_AUTH_SECRET_FILE)');
  process.exit(1);
}

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
