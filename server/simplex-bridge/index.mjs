// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.
//
// Nephtys — pont « pur tuyau d'octets » WebSocket <-> TLS natif SMP.
//
// Les navigateurs ne peuvent pas ouvrir de TLS natif (ALPN smp/1) vers un
// serveur SimpleX. Ce pont expose un WebSocket et relaie **octet pour octet**
// vers un serveur SMP natif (par défaut smp10.simplex.im:5223). Aucune logique
// de protocole : le client (navigateur) fait tout le handshake/la crypto.
//
// Variables : BRIDGE_PORT, SMP_HOST, SMP_PORT, SMP_REJECT_UNAUTHORIZED.

import { WebSocketServer } from 'ws';
import tls from 'node:tls';

const PORT = Number(process.env.BRIDGE_PORT || 8098);
const HOST = process.env.SMP_HOST || 'smp10.simplex.im';
const SMP_PORT = Number(process.env.SMP_PORT || 5223);
const REJECT_UNAUTH = process.env.SMP_REJECT_UNAUTHORIZED !== 'false';

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('listening', () => {
  console.log(`[simplex-bridge] ws://127.0.0.1:${PORT} -> ${HOST}:${SMP_PORT} (ALPN smp/1)`);
});

wss.on('connection', socket => {
  const upstream = tls.connect({
    host: HOST,
    port: SMP_PORT,
    servername: HOST,
    ALPNProtocols: ['smp/1'],
    rejectUnauthorized: REJECT_UNAUTH,
  });

  upstream.on('data', chunk => {
    if (socket.readyState === socket.OPEN) socket.send(chunk);
  });
  upstream.on('error', err => {
    console.error('[simplex-bridge] upstream error:', err.message);
    try { socket.close(1011); } catch { /* ignore */ }
  });
  upstream.on('close', () => { try { socket.close(); } catch { /* ignore */ } });

  socket.on('message', data => {
    if (!upstream.destroyed) upstream.write(data);
  });
  socket.on('close', () => upstream.destroy());
  socket.on('error', () => upstream.destroy());
});