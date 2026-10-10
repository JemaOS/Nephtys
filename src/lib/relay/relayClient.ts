// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Point d'entrée client du mode privé anonyme.
 *
 * Un seul `PrivateMessenger` (et son magasin de connexions local) par session,
 * pointé sur le relais `VITE_RELAY_URL`.
 */

import { WebSocketWire, type RelayWire } from './wire';
import { SupabaseRelayWire } from './supabaseRelayWire';
import { AgentRelayWire } from './agentRelayWire';
import { SmpRelayWire } from './smpRelayWire';
import { FailoverRelayWire } from './failoverRelayWire';
import { PrivateMessenger } from './privateMessenger';
import { IdbConnectionStore } from './connectionStore';
import { IdbHistoryStore } from './historyStore';

let instance: PrivateMessenger | null = null;

/** Vrai si un agent SimpleX local a été détecté (mode privé → SMP SimpleX). */
let agentReachable = false;

const AGENT_URL =
  (import.meta.env.VITE_SMP_AGENT_URL as string | undefined) ?? 'ws://127.0.0.1:5225';

/**
 * Tente de joindre un agent SimpleX local (transparent, sans config). Résout
 * `true` si une connexion WebSocket s'ouvre. Best-effort : échec silencieux.
 * Note : en prod `https`, `ws://localhost` est bloqué par le navigateur
 * (mixed content) → l'agent doit être en `wss://` ou l'app servie en http.
 */
export async function probeLocalAgent(url: string = AGENT_URL): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    try {
      const Ws = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
      if (!Ws) return resolve(false);
      const ws = new Ws(url);
      let settled = false;
      const done = (v: boolean): void => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        resolve(v);
      };
      const timer = setTimeout(() => done(false), 1200);
      ws.onopen = () => {
        clearTimeout(timer);
        agentReachable = true;
        done(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        done(false);
      };
    } catch {
      resolve(false);
    }
  });
}

// Détection en tâche de fond au chargement (n'affecte pas le mode par défaut).
void probeLocalAgent();

const RELAY_OVERRIDE_KEY = 'nephtys_relay_url';

/** Vrai pour un relais local (127.0.0.1 / localhost) — valeur de DEV à ignorer. */
function isLocalRelay(url: string): boolean {
  return /^(wss?:\/\/)?(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(url.trim());
}

/**
 * Vrai si un relais WebSocket **externe** est configuré (override à chaud ou env).
 * Les relais **locaux** (127.0.0.1/localhost) sont ignorés : ce sont des valeurs
 * de dev qui ne doivent pas court-circuiter le relais SMP par défaut.
 */
export function hasCustomRelay(): boolean {
  try {
    const o = localStorage.getItem(RELAY_OVERRIDE_KEY);
    if (o && !isLocalRelay(o)) return true;
  } catch {
    // localStorage indisponible
  }
  const envUrl = import.meta.env.VITE_RELAY_URL as string | undefined;
  return !!(envUrl && !isLocalRelay(envUrl));
}

/**
 * URL du relais externe. Priorité : override « à chaud » (localStorage, non local)
 * puis `VITE_RELAY_URL` (non local). Vide si aucun relais externe → SMP par défaut.
 */
export function getRelayUrl(): string {
  try {
    const override = localStorage.getItem(RELAY_OVERRIDE_KEY);
    if (override && !isLocalRelay(override)) return override;
  } catch {
    // localStorage indisponible → on ignore l'override
  }
  const envUrl = import.meta.env.VITE_RELAY_URL as string | undefined;
  return envUrl && !isLocalRelay(envUrl) ? envUrl : '';
}

/** Libellé lisible du transport privé actif (générique, rassurant). */
export function getRelayLabel(): string {
  return hasCustomRelay() ? getRelayUrl() : 'Réseau privé chiffré';
}

/**
 * Change le relais à chaud (ex. `wss://xxxx.onion`). Vide = revenir au relais
 * Supabase par défaut. Prend effet au prochain rechargement.
 */
export function setRelayUrl(url: string): void {
  try {
    const trimmed = url.trim();
    if (trimmed) localStorage.setItem(RELAY_OVERRIDE_KEY, trimmed);
    else localStorage.removeItem(RELAY_OVERRIDE_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

const TOR_ENABLED_KEY = 'nephtys_tor_enabled';
const ONION_URL_KEY = 'nephtys_smp_onion_url';

/**
 * Vrai si le mode Tor strict est activé (préférence locale, jamais envoyée au
 * serveur). Invariant : « Tor activé » implique une adresse `.onion`
 * configurée. Si l'adresse a disparu, on **désactive proprement** (auto-
 * réparation) au lieu de retomber en clair tout en affichant un état « Tor ».
 */
export function isTorRelayEnabled(): boolean {
  let enabled = false;
  try {
    enabled = localStorage.getItem(TOR_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
  if (enabled && !getOnionRelayUrl()) {
    try {
      localStorage.removeItem(TOR_ENABLED_KEY);
    } catch {
      // localStorage indisponible
    }
    return false;
  }
  return enabled;
}

/** Active/désactive le routage Tor. Prend effet à la prochaine connexion. */
export function setTorRelayEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(TOR_ENABLED_KEY, '1');
    else localStorage.removeItem(TOR_ENABLED_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * Normalise une adresse de relais Tor en URL WebSocket `ws://…`.
 * Accepte `x.onion`, `http(s)://x.onion`, `ws(s)://x.onion`, avec chemin
 * optionnel. Renvoie '' si l'entrée n'est pas une adresse `.onion` valide.
 */
export function normalizeOnionWsUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  const stripped = value.replace(/^[a-z]+:\/\//i, '');
  const host = stripped.split('/')[0];
  if (!/^[a-z2-7]{16,56}\.onion(?::\d+)?$/i.test(host)) return '';
  return `ws://${stripped}`;
}

/**
 * Adresse `.onion` du relais Tor (normalisée en `ws://…`). Priorité : override
 * local (saisi dans l'UI) puis `VITE_SMP_RELAY_ONION_URL`. Vide si aucune
 * adresse Tor n'est configurée.
 */
export function getOnionRelayUrl(): string {
  try {
    const override = localStorage.getItem(ONION_URL_KEY);
    if (override) return normalizeOnionWsUrl(override);
  } catch {
    // localStorage indisponible
  }
  const envUrl = import.meta.env.VITE_SMP_RELAY_ONION_URL as string | undefined;
  return envUrl ? normalizeOnionWsUrl(envUrl) : '';
}

/**
 * Définit l'adresse `.onion` du relais Tor ('' = aucune). La valeur est
 * normalisée au moment de la lecture ; prise en compte à la prochaine connexion.
 */
export function setOnionRelayUrl(url: string): void {
  try {
    const trimmed = url.trim();
    if (trimmed) localStorage.setItem(ONION_URL_KEY, trimmed);
    else localStorage.removeItem(ONION_URL_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * URL de la passerelle Tor hébergée sur l'infra (WebSocket « clearnet » qui
 * relaie la session vers le relais distant À TRAVERS le réseau Tor). C'est ce
 * qui rend le mode Tor utilisable depuis un navigateur ordinaire, sans Tor
 * Browser ni réglage : le navigateur ne parle qu'à cette passerelle.
 *
 * Priorité : `VITE_TOR_GATEWAY_URL` puis dérivation depuis `VITE_SMP_RELAY_URL`
 * (chemin `/tor`). Ex. `wss://relay.exemple/` → `wss://relay.exemple/tor`.
 */
export function getTorGatewayUrl(): string {
  const envGateway = import.meta.env.VITE_TOR_GATEWAY_URL as string | undefined;
  if (envGateway?.trim()) return envGateway.trim();
  const relay =
    (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
  try {
    const u = new URL(relay);
    u.pathname = '/tor';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

/**
 * Point d'entrée Tor du mode privé. **Mode strict : uniquement l'adresse
 * `.onion`.** Aucun repli sur une passerelle clearnet — un repli exposerait
 * l'IP réelle et recollerait les rôles « voit ton IP » et « voit ta
 * destination ». Vide si aucune adresse `.onion` n'est configurée.
 */
export function getTorRelayUrl(): string {
  return getOnionRelayUrl();
}

/**
 * Vrai si le mode Tor strict est exploitable, c'est-à-dire si une adresse
 * `.onion` du relais est configurée. Sans elle, Tor n'est pas disponible.
 */
export function isTorAvailable(): boolean {
  return Boolean(getOnionRelayUrl());
}

export function getPrivateMessenger(): PrivateMessenger {
  if (!instance) {
    const mode = import.meta.env.VITE_RELAY_MODE as string | undefined;
    const smpUrl =
      (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
    const smpKeyHash = import.meta.env.VITE_SMP_RELAY_KEY_HASH as string | undefined;
    const torUrl = getTorRelayUrl();
    let wire: RelayWire;
    if (isTorRelayEnabled()) {
      // Mode Tor STRICT : uniquement l'adresse `.onion`. Fail-closed — si elle
      // manque, on refuse au lieu de retomber en clair (aucune exposition d'IP).
      if (!torUrl) {
        throw new Error(
          'Mode Tor strict : aucune adresse .onion configurée (Paramètres → Confidentialité).',
        );
      }
      wire = new SmpRelayWire({ url: torUrl });
    } else if (mode === 'simplex-smp') {
      // Relais SimpleX SMP (browser-profile) — OPTION EXPLICITE.
      // ⚠️ WIP : l'adaptateur SmpRelayWire ne couvre pas encore le modèle de
      // connexion à deux files du mode privé ; à finaliser avant usage prod.
      wire = new SmpRelayWire({ url: smpUrl, keyHash: smpKeyHash });
    } else if (mode === 'simplex-agent') {
      wire = new AgentRelayWire(AGENT_URL);
    } else if (hasCustomRelay()) {
      wire = new WebSocketWire(getRelayUrl());
    } else {
      // DÉFAUT : SMP (SimpleX browser-profile) PRIORITAIRE, repli automatique sur
      // le relais aveugle Supabase si le premier est injoignable → le mode privé
      // fonctionne toujours. (Un relais local 127.0.0.1 traînant est ignoré.)
      wire = new FailoverRelayWire(
        new SmpRelayWire({ url: smpUrl, keyHash: smpKeyHash }),
        new SupabaseRelayWire(),
      );
    }
    instance = new PrivateMessenger(
      wire,
      new IdbConnectionStore(),
      undefined,
      new IdbHistoryStore(),
    );
  }
  return instance;
}
