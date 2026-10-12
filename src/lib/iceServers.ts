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
 * la récupère et la rafraîchit. Repli STUN **de notre propre coturn** tant que
 * l'endpoint n'a pas répondu (aucun STUN tiers : Google/Twilio retirés).
 */

const TURN_CREDS_URL =
  (import.meta.env.VITE_TURN_CREDS_URL as string | undefined) || 'https://78-232-3-78.sslip.io/turn';

// Repli tant que l'endpoint `/turn` n'a pas répondu : STUN **de notre propre
// coturn** uniquement (dérivé de l'hôte du endpoint). Aucun STUN tiers
// (Google/Twilio) → un call P2P n'annonce pas l'IP à un tiers, et le relais
// reste maîtrisé. Si l'hôte est introuvable, repli VIDE : on n'émet alors
// aucun candidat srflx et le mode privé reste fail-closed (cf. hasTurnServer).
const TURN_HOST: string | null = (() => {
  try {
    return new URL(TURN_CREDS_URL).hostname || null;
  } catch {
    return null;
  }
})();

const STUN_FALLBACK: RTCIceServer[] = TURN_HOST
  ? [{ urls: `stun:${TURN_HOST}:3478` }]
  : [];

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

// ─── Appels via relais (TURN force) ───────────────────────────────────

const RELAY_ONLY_KEY = 'nephtys_calls_relay_only';

/**
 * Vrai si les appels doivent forcer le relais TURN (iceTransportPolicy: relay).
 *
 * **Relais forcé par défaut** (fail-safe IP) : un appel WebRTC en P2P direct
 * échange des candidats ICE contenant l'adresse IP réelle de l'appareil. Pour
 * les appels privés/anon il ne faut donc PAS fuiter l'IP → on force le relais
 * TURN sauf désactivation explicite (valeur '0').
 */
export function isRelayOnlyCallsEnabled(): boolean {
  try {
    return localStorage.getItem(RELAY_ONLY_KEY) !== '0';
  } catch {
    return true;
  }
}

/** Active/desactive le passage force par relais TURN pour les appels. */
export function setRelayOnlyCallsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(RELAY_ONLY_KEY, enabled ? '1' : '0');
  } catch {
    // localStorage indisponible
  }
}

/**
 * Vrai si au moins un serveur TURN est disponible dans la config courante.
 *
 * Sans TURN, un appel privé/anon ne peut PAS être relayé : il basculerait en
 * P2P direct, exposant l'adresse IP réelle de l'appareil. Les appels privés
 * doivent donc REFUSER l'appel plutôt que de retomber en P2P (fail-closed IP).
 */
export function hasTurnServer(): boolean {
  return getIceServers().some(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(u => typeof u === 'string' && u.startsWith('turn'));
  });
}

/**
 * Config RTCConfiguration pour un PeerConnection. Force le relais (TURN) par
 * défaut (masque l'IP) ; passer `{ relayOnly: false }` pour l'autoriser en P2P
 * direct (déconseillé : fuite d'IP).
 */
export function getPeerConnectionConfig(options?: { relayOnly?: boolean }): RTCConfiguration {
  const iceServers = getIceServers();
  const config: RTCConfiguration = { iceServers };
  const wantsRelay = options?.relayOnly ?? isRelayOnlyCallsEnabled();
  // On ne force le relais QUE si des serveurs TURN sont réellement disponibles.
  // Sinon (creds pas encore chargées, endpoint /turn indisponible, ou repli
  // STUN seul) forcer `iceTransportPolicy: 'relay'` donnerait ZÉRO candidature
  // → l'appel échouerait. Priorité : ne jamais casser l'appel.
  if (wantsRelay && hasTurnServer()) config.iceTransportPolicy = 'relay';
  return config;
}
