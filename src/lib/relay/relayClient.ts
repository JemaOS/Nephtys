// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Point d'entrée client du mode privé anonyme.
 *
 * Un seul `PrivateMessenger` (et son magasin de connexions local) par session,
 * pointé sur le relais `VITE_RELAY_URL`.
 */

import { WebSocketWire, isAllowedRelayUrl, type RelayWire } from './wire';
import { SupabaseRelayWire } from './supabaseRelayWire';
import { AgentRelayWire } from './agentRelayWire';
import { SmpRelayWire } from './smpRelayWire';
import { createTorWebSocketImpl } from './torClient';
import { FailoverRelayWire } from './failoverRelayWire';
import { MultiRelayWire } from './multiRelayWire';
import { PrivateMessenger } from './privateMessenger';
import { IdbConnectionStore } from './connectionStore';
import { IdbHistoryStore } from './historyStore';

let instance: PrivateMessenger | null = null;

/**
 * Instance de repli (SMP → Supabase) éventuellement active, pour remonter la
 * dégradation de transport dans l'UI (avertissement explicite à l'utilisateur).
 */
let failoverWire: FailoverRelayWire | null = null;
const transportListeners = new Set<(active: boolean) => void>();

/** Vrai si le transport privé a basculé sur le relais de repli (état dégradé). */
export function isRelayFallbackActive(): boolean {
  return failoverWire?.onFallback ?? false;
}

/** S'abonne aux changements d'état du transport (repli SMP→Supabase). */
export function onRelayTransportChange(cb: (active: boolean) => void): () => void {
  transportListeners.add(cb);
  return () => { transportListeners.delete(cb); };
}

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
// Uniquement si un agent local est explicitement configuré, sinon le probe par
// défaut (ws://127.0.0.1:5225) est bloqué par la CSP → erreur console inutile.
if (import.meta.env.VITE_SMP_AGENT_URL) void probeLocalAgent();

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
 *
 * Renvoie `true` si l'URL a été acceptée (ou vidée), `false` si elle a été
 * REFUSÉE (hôte distant en clair) — l'appelant ne doit pas recharger dans ce cas.
 */
export function setRelayUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed && !isAllowedRelayUrl(trimmed)) {
    // Refuse le clair vers un hôte distant (wss:// requis hors loopback/.onion).
    console.warn('[relay] URL refusée (wss:// requis) :', trimmed);
    return false;
  }
  try {
    if (trimmed) localStorage.setItem(RELAY_OVERRIDE_KEY, trimmed);
    else localStorage.removeItem(RELAY_OVERRIDE_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
  failoverWire = null;
  return true;
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
  if (enabled && !getTorRelayUrl()) {
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
  failoverWire = null;
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
 * Point d'entrée Tor du mode privé. Priorité à une adresse `.onion` si elle est
 * fournie (Tor natif), sinon la **passerelle Tor** de l'infra : un clic depuis
 * n'importe quel navigateur, **sans logiciel externe ni Tor Browser**. Vide si
 * aucun point d'entrée n'est disponible.
 */
export function getTorRelayUrl(): string {
  return getOnionRelayUrl() || getTorGatewayUrl();
}

/** Vrai si un point d'entrée Tor est disponible (`.onion` ou passerelle). */
export function isTorAvailable(): boolean {
  return Boolean(getTorRelayUrl());
}

// ─── Réseau décentralisé (pool de relais, façon SimpleX) ──────────────

const DECENTRALIZED_KEY = 'nephtys_decentralized_relays';
const RELAY_POOL_KEY = 'nephtys_relay_pool';
const RELAY_MODE_KEY = 'nephtys_relay_mode';

function defaultRelayUrl(): string {
  return (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
}

/** Valeur brute du pool de relais (saisie UI ou `VITE_SMP_RELAY_URLS`). */
export function getRelayPoolInput(): string {
  try {
    const stored = localStorage.getItem(RELAY_POOL_KEY);
    if (stored) return stored;
  } catch {
    // localStorage indisponible
  }
  return (import.meta.env.VITE_SMP_RELAY_URLS as string | undefined) ?? '';
}

/** Enregistre le pool de relais (liste separee par virgules / espaces / retours). */
export function setRelayPool(input: string): void {
  // Filtre STRICT : seuls les relais autorisés (wss://, ou ws:// loopback/.onion)
  // sont conservés — jamais un `ws://` en clair vers un hôte distant.
  const allowed = input
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(isAllowedRelayUrl);
  try {
    if (allowed.length) localStorage.setItem(RELAY_POOL_KEY, allowed.join(','));
    else localStorage.removeItem(RELAY_POOL_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/** Mode du réseau décentralisé : automatique (aucune saisie) ou manuel. */
export type RelayMode = 'auto' | 'manual';

/** Mode mémorisé (défaut : 'auto' → aucune saisie requise). */
export function getRelayMode(): RelayMode {
  try {
    return localStorage.getItem(RELAY_MODE_KEY) === 'manual' ? 'manual' : 'auto';
  } catch {
    return 'auto';
  }
}

/** Mémorise le mode du réseau décentralisé. Prend effet a la prochaine connexion. */
export function setRelayMode(mode: RelayMode): void {
  try {
    if (mode === 'manual') localStorage.setItem(RELAY_MODE_KEY, 'manual');
    else localStorage.removeItem(RELAY_MODE_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * Relais disponibles connus (union dedupliquee, uniquement `wss://`) : relais
 * par defaut, `VITE_SMP_RELAY_URLS`, et le pool actuellement stocke. Base de la
 * liste « relais existants » proposee dans l'UI (data-driven : ajouter des
 * relais via env ne demande aucun changement de code).
 */
export function getAvailableRelays(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const url = raw.trim();
    if (!/^wss:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  push(defaultRelayUrl());
  const envUrls = import.meta.env.VITE_SMP_RELAY_URLS as string | undefined;
  if (envUrls) envUrls.split(/[\s,]+/).forEach(push);
  try {
    const stored = localStorage.getItem(RELAY_POOL_KEY);
    if (stored) stored.split(/[\s,]+/).forEach(push);
  } catch {
    // localStorage indisponible
  }
  return out;
}

/**
 * Liste effective des relais. En mode 'auto' : tous les relais disponibles
 * (aucune saisie requise). En mode 'manual' : le pool saisi/env, sinon le
 * relais par defaut.
 */
export function getRelayPool(): string[] {
  const raw =
    getRelayMode() === 'auto'
      ? getAvailableRelays()
      : (getRelayPoolInput() || defaultRelayUrl())
          .split(/[\s,]+/)
          .map(s => s.trim())
          .filter(Boolean);
  // Filtre défensif (auto ET manuel) : jamais de relais en clair non autorisé.
  return raw.filter(isAllowedRelayUrl);
}

/** Vrai si le reseau decentralise (pool de relais) est active. */
export function isDecentralizedRelayEnabled(): boolean {
  try {
    return localStorage.getItem(DECENTRALIZED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Active/desactive le reseau decentralise. Prend effet a la prochaine connexion. */
export function setDecentralizedRelayEnabled(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(DECENTRALIZED_KEY, '1');
    else localStorage.removeItem(DECENTRALIZED_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * Vrai si un relais EXTERNE est réellement configuré : soit un relais unique
 * (override/env), soit le **réseau décentralisé** activé (mode automatique ou
 * sélection de relais). Exclut les relais locaux de dev (127.0.0.1/localhost).
 * Sert à l'affichage (bandeau « relais par défaut ») : il ne doit PAS rester
 * affiché quand le réseau décentralisé est configuré.
 */
export function hasExternalRelayConfigured(): boolean {
  if (hasCustomRelay()) return true;
  if (isDecentralizedRelayEnabled()) {
    return getRelayPool().some(url => !isLocalRelay(url));
  }
  return false;
}

export function getPrivateMessenger(): PrivateMessenger {
  if (!instance) {
    const mode = import.meta.env.VITE_RELAY_MODE as string | undefined;
    const smpUrl =
      (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
    const smpKeyHash = import.meta.env.VITE_SMP_RELAY_KEY_HASH as string | undefined;
    let wire: RelayWire;
    if (isTorRelayEnabled()) {
      // Mode Tor WASM : client Tor DANS le navigateur (tor-js) ; la passerelle
      // KPS du VPS ne relaie que des octets opaques. Fail-closed : aucun repli
      // en clair (donc aucune exposition d'IP si Tor échoue).
      wire = new SmpRelayWire({
        url: 'wss://tor.gateway/',
        keyHash: '',
        webSocketImplFactory: createTorWebSocketImpl,
      });
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
      const pool = getRelayPool();
      const primaryWire =
        isDecentralizedRelayEnabled() && pool.length > 1
          // Réseau décentralisé : une file par relais (round-robin + repli).
          ? new MultiRelayWire(
              pool.map(url => ({ url, wire: new SmpRelayWire({ url, keyHash: smpKeyHash }) })),
            )
          // Relais décentralisé unique sélectionné : on l'utilise (sinon l'env
          // par défaut était utilisé et la sélection était ignorée).
          : new SmpRelayWire({
              url: (isDecentralizedRelayEnabled() && pool[0]) || smpUrl,
              keyHash: smpKeyHash,
            });
      const fw = new FailoverRelayWire(
        primaryWire,
        new SupabaseRelayWire(),
        active => { for (const cb of transportListeners) cb(active); },
      );
      failoverWire = fw;
      wire = fw;
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
