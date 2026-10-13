// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Données réseau du mode privé : IP publique (écho), IP de sortie et adresses
 * des relais actifs.
 *
 * ⚠️ L'écho d'IP est appelé UNIQUEMENT quand la page Réseau est ouverte. Son hôte
 * doit être autorisé par la CSP `connect-src` (voir `vercel.json`) — par défaut
 * `api64.ipify.org` (renvoie uniquement l'IP, sans géolocalisation tierce).
 * Surchargeable par `VITE_IP_ECHO_URL` (ajouter alors l'hôte à la CSP).
 */

import { getOnionRelayUrl, getSmpBridgeUrl, isSmpV9Enabled, isTorRelayEnabled } from './relayClient';

let ipCache: string | null = null;

/** Récupère l'IP publique via un écho (mémoïsé). `null` si indisponible. */
export async function fetchPublicIp(): Promise<string | null> {
  if (ipCache) return ipCache;
  const endpoint =
    (import.meta.env.VITE_IP_ECHO_URL as string | undefined)?.trim() ||
    'https://api64.ipify.org?format=json';
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const ip = typeof j.ip === 'string' ? j.ip.trim() : '';
    if (!ip) return null;
    ipCache = ip;
    return ip;
  } catch {
    return null;
  }
}

/** IP / chemin de SORTIE (ce que voit le serveur distant) selon le transport actif. */
export interface EgressInfo {
  transport: string;
  /** IP vue par le serveur distant, ou description si masquée. */
  ip: string;
  /** Vrai si l'IP de sortie est masquée/anonymisée. */
  masked: boolean;
}

export function egressInfo(): EgressInfo {
  if (isTorRelayEnabled()) {
    return { transport: 'Tor', ip: 'masquée (nœud de sortie Tor aléatoire)', masked: true };
  }
  if (isSmpV9Enabled()) {
    return { transport: 'SMP via pont', ip: '78.232.3.78', masked: false };
  }
  return { transport: 'Direct (Supabase)', ip: 'votre IP d’entrée', masked: false };
}

/** IP/hôte du pont SMP courant (diagnostic). */
export function currentBridge(): string {
  return getSmpBridgeUrl();
}

/** Adresse `.onion` courante (si Tor actif). */
export function currentOnion(): string {
  return getOnionRelayUrl();
}
