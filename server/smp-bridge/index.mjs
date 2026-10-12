// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Nephtys — pont « pur tuyau d'octets » WebSocket <-> TLS natif SMP.
//
// Les navigateurs ne peuvent pas ouvrir de TLS natif (ALPN smp/1) vers un
// serveur SMP. Ce pont expose un WebSocket et relaie **octet pour octet** vers
// un serveur SMP natif. Aucune logique de protocole : le client (navigateur)
// fait tout le handshake/la crypto.
//
// Cible : `?host=<hote>` (liste blanche `ALLOWED_HOSTS`), sinon `SMP_HOST`.
// Variables : BRIDGE_PORT, SMP_HOST, SMP_PORT, SMP_REJECT_UNAUTHORIZED,
//             ALLOWED_HOSTS (suffixes séparés par des virgules).

import { WebSocketServer } from 'ws';
import tls from 'node:tls';

const PORT = Number(process.env.BRIDGE_PORT || 8098);
const DEFAULT_HOST = process.env.SMP_HOST || 'smp10.simplex.im';
const SMP_PORT = Number(process.env.SMP_PORT || 5223);
const REJECT_UNAUTH = process.env.SMP_REJECT_UNAUTHORIZED !== 'false';
const ALLOWED = (process.env.ALLOWED_HOSTS || 'simplex.im').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

function allowedHost(host) {
  if (!host) return DEFAULT_HOST;
  const h = String(host).toLowerCase();
  return ALLOWED.some(suffix => h === suffix || h.endsWith('.' + suffix)) ? h : null;
}

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('listening', () => {
  console.log(`[smp-bridge] ws://127.0.0.1:${PORT} -> ${DEFAULT_HOST}:${SMP_PORT} (ALPN smp/1, allowed=${ALLOWED.join('|')})`);
});

wss.on('connection', (socket, req) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const host = allowedHost(url.searchParams.get('host'));
  if (!host) {
    try { socket.close(1008, 'host non autorisé'); } catch { /* ignore */ }
    return;
  }

  const upstream = tls.connect({
    host,
    port: SMP_PORT,
    servername: host,
    ALPNProtocols: ['smp/1'],
    rejectUnauthorized: REJECT_UNAUTH,
  });

  upstream.on('data', chunk => {
    if (socket.readyState === socket.OPEN) socket.send(chunk);
  });
  upstream.on('error', err => {
    console.error('[smp-bridge] upstream error:', err.message);
    try { socket.close(1011); } catch { /* ignore */ }
  });
  upstream.on('close', () => { try { socket.close(); } catch { /* ignore */ } });

  socket.on('message', data => {
    if (!upstream.destroyed) upstream.write(data);
  });
  socket.on('close', () => upstream.destroy());
  socket.on('error', () => upstream.destroy());
});