// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Serveurs ICE partagés (STUN + **TURN**) pour WebRTC.
 *
 * TURN = **coturn** hébergé sur notre VPS : relaie le média audio/vidéo quand le
 * P2P direct échoue (NAT symétrique / pare-feu), ce qui **stabilise les appels**.
 * Sans TURN, de nombreux appels ne s'établissent jamais.
 *
 * `turns:` (5349, TLS) traverse les réseaux très restrictifs ; `turn:` 3478
 * (UDP + TCP) couvre le reste. Surchargeable via variables d'environnement.
 *
 * ⚠️ Les identifiants TURN sont embarqués (app web) → abuse possible. Pour de la
 * prod à grande échelle, servir ces identifiants via un endpoint à credentials
 * éphémères (TURN REST API). Acceptable pour un usage perso/interne.
 */

const TURN_HOST = (import.meta.env.VITE_TURN_HOST as string | undefined) || '78-232-3-78.sslip.io';
const TURN_USERNAME = (import.meta.env.VITE_TURN_USERNAME as string | undefined) || 'nephtys';
const TURN_CREDENTIAL = (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) || 'BMFZPSQiakqiAgzcDH7M';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  {
    urls: [
      `turn:${TURN_HOST}:3478?transport=udp`,
      `turn:${TURN_HOST}:3478?transport=tcp`,
      `turns:${TURN_HOST}:5349?transport=tcp`,
    ],
    username: TURN_USERNAME,
    credential: TURN_CREDENTIAL,
  },
];
