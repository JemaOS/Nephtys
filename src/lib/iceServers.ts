// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Serveurs ICE partagés (STUN + **TURN éphémère**) pour WebRTC.
 *
 * Le TURN (coturn sur notre VPS) relaie le média quand le P2P échoue
 * (NAT symétrique) → **stabilité des appels**. Les identifiants sont
 * **éphémères** (TURN REST API) récupérés depuis notre endpoint `/turn` :
 * le **secret n'est jamais dans le bundle web** (fini l'abus d'identifiants).
 *
 * `getIceServers()` (synchrone) renvoie la config en cache ; `initIceServers()`
 * la récupère et la rafraîchit. Repli STUN tant que l'endpoint n'a pas répondu.
 */

const TURN_CREDS_URL =
  (import.meta.env.VITE_TURN_CREDS_URL as string | undefined) || 'https://78-232-3-78.sslip.io/turn';

const STUN_FALLBACK: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

let cachedIceServers: RTCIceServer[] = STUN_FALLBACK;
let expiresAt = 0;
let refreshing: Promise<void> | null = null;

/** Config ICE courante (cache). Synchrone, à utiliser à la création du PeerConnection. */
export function getIceServers(): RTCIceServer[] {
  return cachedIceServers;
}

/** Récupère/rafraîchit les identifiants TURN éphémères depuis l'endpoint. */
export async function refreshIceServers(): Promise<void> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const res = await fetch(TURN_CREDS_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as { iceServers?: RTCIceServer[]; ttl?: number };
      if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
        cachedIceServers = data.iceServers;
        const ttl = Number(data.ttl) || 3600;
        expiresAt = Date.now() + Math.max(60, ttl - 300) * 1000;
      }
    } catch {
      // garde le cache/repli
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/** À appeler au démarrage : charge les creds puis rafraîchit avant expiration. */
export function initIceServers(): void {
  void refreshIceServers();
  setInterval(() => {
    if (Date.now() >= expiresAt) void refreshIceServers();
  }, 60 * 1000);
}
