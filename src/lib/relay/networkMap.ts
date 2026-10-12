// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Modèle de la carte réseau du mode privé : nœuds géolocalisés (approximatifs),
 * flux, informations d'IP (entrée/sortie) et descriptions de chiffrement par saut.
 *
 * ⚠️ Honnêteté : les positions des relais sont APPROXIMATIVES (les serveurs SMP
 * publics et les sorties Tor n'exposent pas leur géolocalisation). La position de
 * l'appareil et l'IP d'entrée proviennent d'un service de géo-IP **externe**,
 * appelé UNIQUEMENT à la demande (page Réseau ouverte) — jamais en arrière-plan.
 */

import {
  getOnionRelayUrl,
  getSmpBridgeUrl,
  getSmpV9Host,
  isSmpV9Enabled,
  isTorRelayEnabled,
} from './relayClient';

export type GlobeNodeKind = 'device' | 'bridge' | 'smp' | 'supabase' | 'tor' | 'xftp';

export interface GlobeNode {
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** Couleur (héxadécimal, cohérente avec le thème). */
  color: number;
  kind: GlobeNodeKind;
  /** Position approximative (relais). */
  approx?: boolean;
}

export interface GlobeFlow {
  id: number;
  from: string;
  to: string;
  ok: boolean;
  layer: string;
}

export const NODE_DEVICE = 'device';
export const NODE_BRIDGE = 'bridge';
export const NODE_SMP = 'smp';
export const NODE_SUPABASE = 'supabase';
export const NODE_TOR = 'tor';
export const NODE_XFTP = 'xftp';

/** Positions par défaut (approximatives) des relais connus. */
const BRIDGE_POS = { lat: 50.69, lng: 3.17 }; // VPS opérateur (OVH, France)
const SUPABASE_POS = { lat: 48.85, lng: 2.35 }; // Supabase eu-west-3 (Paris)
const SMP_POS = { lat: 52.37, lng: 4.9 }; // résea SMP public (≈ Amsterdam)
const XFTP_POS = { lat: 50.11, lng: 8.68 }; // serveurs XFTP (≈ Francfort)
const TOR_POS = { lat: 51.5, lng: -0.12 }; // sortie Tor inconnue (≈ neutre)

export interface GeoIp {
  ip: string;
  lat: number;
  lng: number;
  city?: string;
  country?: string;
}

let geoCache: GeoIp | null = null;

/**
 * Récupère l'IP publique + géolocalisation APPROXIMATIVE de l'appareil.
 * Appel externe unique, mémoïsé. `null` si indisponible (aucune erreur remontée).
 * Configurable via `VITE_GEOIP_URL` (par défaut `https://ipapi.co/json/`).
 */
export async function fetchGeoIp(): Promise<GeoIp | null> {
  if (geoCache) return geoCache;
  const endpoint =
    (import.meta.env.VITE_GEOIP_URL as string | undefined)?.trim() || 'https://ipapi.co/json/';
  try {
    const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const lat = Number(j.latitude);
    const lng = Number(j.longitude);
    const ip = typeof j.ip === 'string' ? j.ip : '';
    if (!ip || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    geoCache = {
      ip,
      lat,
      lng,
      city: typeof j.city === 'string' ? j.city : undefined,
      country: typeof j.country_name === 'string' ? j.country_name : undefined,
    };
    return geoCache;
  } catch {
    return null;
  }
}

/** Position de repli pour l'appareil si la géo-IP est indisponible. */
const DEVICE_FALLBACK = { lat: 48.85, lng: 2.35 };

export interface BuildNodesOptions {
  device?: GeoIp | null;
  torEnabled?: boolean;
  smpV9Enabled?: boolean;
}

/**
 * Construit la liste des nœuds à afficher d'après la configuration ACTIVE
 * (Tor, pont SMP, relais SMP, Supabase, XFTP) + l'appareil.
 */
export function buildGlobeNodes(opts: BuildNodesOptions = {}): GlobeNode[] {
  const tor = opts.torEnabled ?? isTorRelayEnabled();
  const smpV9 = opts.smpV9Enabled ?? isSmpV9Enabled();
  const dev = opts.device;
  const nodes: GlobeNode[] = [
    {
      id: NODE_DEVICE,
      label: 'Vous',
      lat: dev?.lat ?? DEVICE_FALLBACK.lat,
      lng: dev?.lng ?? DEVICE_FALLBACK.lng,
      color: 0x7578db,
      kind: 'device',
    },
  ];
  if (tor) nodes.push({ id: NODE_TOR, label: 'Tor (.onion)', lat: TOR_POS.lat, lng: TOR_POS.lng, color: 0xa78bfa, kind: 'tor', approx: true });
  if (smpV9) {
    nodes.push({ id: NODE_BRIDGE, label: 'Pont SMP', lat: BRIDGE_POS.lat, lng: BRIDGE_POS.lng, color: 0x7578db, kind: 'bridge', approx: true });
    nodes.push({ id: NODE_SMP, label: getSmpV9Host(), lat: SMP_POS.lat, lng: SMP_POS.lng, color: 0x9aa0ff, kind: 'smp', approx: true });
  }
  nodes.push({ id: NODE_SUPABASE, label: 'Supabase', lat: SUPABASE_POS.lat, lng: SUPABASE_POS.lng, color: 0x34d399, kind: 'supabase', approx: true });
  nodes.push({ id: NODE_XFTP, label: 'XFTP', lat: XFTP_POS.lat, lng: XFTP_POS.lng, color: 0x22d3ee, kind: 'xftp', approx: true });
  return nodes;
}

/** Nœud cible d'un flux selon la couche de l'événement netLog. */
export function flowTargetFor(layer: string): string {
  switch (layer) {
    case 'tor':
      return NODE_TOR;
    case 'smp':
      return isTorRelayEnabled() ? NODE_TOR : NODE_SMP;
    case 'smp-v9':
      return NODE_BRIDGE;
    case 'supabase':
      return NODE_SUPABASE;
    case 'xftp':
      return NODE_XFTP;
    default:
      return NODE_SUPABASE;
  }
}

/** IP / chemin de SORTIE (ce que voit le serveur distant) selon le transport actif. */
export interface EgressInfo {
  /** Libellé du transport. */
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

/** Traduit (lat,lng) → vecteur 3D sur une sphère de rayon `r`. */
export function latLngToVec3(lat: number, lng: number, r: number): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lng + 180) * Math.PI) / 180;
  return [-r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)];
}
