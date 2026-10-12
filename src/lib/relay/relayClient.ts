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
import { SmpV9Wire, SMP_RELAY_PRESETS } from './smpV9Wire';
import { createTorWebSocketImpl, getTorClient } from './torClient';
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

/**
 * Budget (ms) accordé au transport **prioritaire** avant de démarrer le repli
 * **en parallèle** (cf. `FailoverRelayWire` `hedgeMs`). Borne la latence de
 * création de la connexion privée quand le primaire est lent à s'établir
 * (bootstrap du client Tor WASM, pont SMP lent) : au pire on crée sur le repli
 * en ~`hedgeMs` + latence du secondaire, au lieu d'attendre le timeout complet.
 * Configurable via `VITE_RELAY_PRIMARY_HEDGE_MS` (défaut 6000, borné ≥ 0).
 */
const PRIMARY_HEDGE_MS = ((): number => {
  const raw = Number(import.meta.env.VITE_RELAY_PRIMARY_HEDGE_MS ?? 6000);
  return Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 6000;
})();

/** Vrai si le transport privé a basculé sur le relais de repli (état dégradé). */
export function isRelayFallbackActive(): boolean {
  return failoverWire?.onFallback ?? false;
}

/** S'abonne aux changements d'état du transport (repli SMP→Supabase). */
export function onRelayTransportChange(cb: (active: boolean) => void): () => void {
  transportListeners.add(cb);
  return () => { transportListeners.delete(cb); };
}

/** Vrai si un agent SMP local a été détecté (mode privé → SMP SMP). */
let agentReachable = false;

const AGENT_URL =
  (import.meta.env.VITE_SMP_AGENT_URL as string | undefined) ?? 'ws://127.0.0.1:5225';

/**
 * Tente de joindre un agent SMP local (transparent, sans config). Résout
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
 *
 * NB honnêteté : l'invariant porte sur une **vraie destination `.onion`**
 * (`getOnionRelayUrl`), PAS sur la passerelle clearnet `/tor`
 * (`getTorGatewayUrl`), qui n'est qu'un signal de disponibilité et n'est pas
 * utilisée comme endpoint de transport (cf. `getTorGatewayUrl`). Sans `.onion`,
 * l'état « Tor » n'a donc **aucun effet** — on ne peut pas afficher « Tor
 * actif » alors que le trafic partirait vers l'infra opérateur.
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
  if (envUrl) return normalizeOnionWsUrl(envUrl);
  // Défaut : relais `.onion` auto-hébergé (transport Tor WASM + XFTP), pour que
  // le mode Tor fonctionne sans configuration. Surchargeable (réglage local ou
  // VITE_SMP_RELAY_ONION_URL).
  return normalizeOnionWsUrl('n72u6is62nlvsqb7dw3uif47jsto2b2ylrww676majsed2dj3grdwsyd.onion');
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
 * URL de la passerelle Tor hébergée sur l'infra (WebSocket « clearnet »).
 *
 * ⚠️ HONNÊTETÉ / LIMITE CONNUE : cette URL n'est utilisée QUE pour un test de
 * **disponibilité** (`isTorAvailable`). Elle n'est **jamais** un endpoint de
 * transport : le mode Tor réel s'appuie sur le client Tor WASM du navigateur
 * (`createTorWebSocketImpl`, cf. `getPrivateMessenger`), et le mode Tor
 * n'entre en vigueur que si une **vraie destination `.onion`** est configurée
 * (`isTorRelayEnabled`). Cette fonction est conservée pour l'UI/diagnostic et
 * ne doit pas être présentée comme « Tor actif ».
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
 * Point d'entrée Tor « de disponibilité » : une adresse `.onion` si elle est
 * fournie, sinon la passerelle clearnet (cf. `getTorGatewayUrl`).
 *
 * ⚠️ Sert au **diagnostic/UI d'accessibilité** uniquement. Le transport Tor
 * effectif est le client Tor WASM (`.onion` requis via `isTorRelayEnabled`) ;
 * cette valeur NE pilote PAS le transport. Vide si rien n'est disponible.
 */
export function getTorRelayUrl(): string {
  return getOnionRelayUrl() || getTorGatewayUrl();
}

/**
 * Vrai si un point d'entrée Tor est **disponible** (`.onion` OU passerelle
 * clearnet). Attention : ce n'est qu'un signal de disponibilité ; « disponible »
 * ne veut pas dire « actif » — l'activation réelle exige un `.onion`
 * (`isTorRelayEnabled`).
 */
export function isTorAvailable(): boolean {
  return Boolean(getTorRelayUrl());
}

// ─── Réseau décentralisé (pool de relais, façon SMP) ──────────────

const DECENTRALIZED_KEY = 'nephtys_decentralized_relays';
const RELAY_POOL_KEY = 'nephtys_relay_pool';
const RELAY_MODE_KEY = 'nephtys_relay_mode';

function defaultRelayUrl(): string {
  return (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
}

/**
 * Hôte du pont WS↔TLS auto-hébergé. Le pont est un **transport interne** : il
 * ne doit JAMAIS apparaître côté utilisateur comme un « relais » (ni listé, ni
 * proposé, ni affiché). Dérivé de l'URL de relais par défaut.
 */
function bridgeHost(): string {
  try {
    return new URL(defaultRelayUrl()).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Vrai si `url` pointe vers le pont auto-hébergé. Sert à filtrer le pont des
 * listes destinées à l'UI (`getAvailableRelays`).
 *
 * Distinction UI vs transport :
 *  - **UI (visible)** : seuls de vrais serveurs SMP / relais non-pont
 *    (`getAvailableRelays`, `getSmpRelayPresets`).
 *  - **Transport (interne)** : le pont reste utilisé par `SmpV9Wire`
 *    (`getSmpBridgeUrl`) et pour la passerelle Tor (`getTorGatewayUrl`), sans
 *    jamais être exposé.
 */
export function isBridgeRelay(url: string): boolean {
  const host = bridgeHost();
  if (!host) return false;
  try {
    return new URL(url.trim()).host.toLowerCase() === host;
  } catch {
    return false;
  }
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
 * SMP / relais non-pont de `VITE_SMP_RELAY_URLS` et du pool actuellement stocke.
 * Base de la liste « relais existants » proposee dans l'UI (data-driven :
 * ajouter des relais via env ne demande aucun changement de code).
 *
 * Le **pont auto-hébergé** (`defaultRelayUrl()`) en est EXCLU : c'est un
 * transport interne, jamais un « relais » visible par l'utilisateur.
 */
export function getAvailableRelays(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string): void => {
    const url = raw.trim();
    if (!/^wss:\/\//i.test(url) || seen.has(url)) return;
    // Le pont est un transport interne : jamais proposé comme « relais » UI.
    if (isBridgeRelay(url)) return;
    seen.add(url);
    out.push(url);
  };
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
 * Liste effective des relais pour le **transport** (pas une liste d'affichage).
 * En mode 'auto' : tous les relais disponibles (jamais le pont, cf.
 * `getAvailableRelays`). En mode 'manual' : le pool saisi/env, sinon le relais
 * par defaut (pont interne, repli de transport).
 *
 * NB : alimente `getPrivateMessenger` ; l'UI ne doit pas afficher cette liste
 * telle quelle (le pont peut y figurer comme repli de transport).
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
  if (isSmpV9Enabled()) return true;
  if (isDecentralizedRelayEnabled()) {
    return getRelayPool().some(url => !isLocalRelay(url));
  }
  return false;
}

// ─── Réseau SMP v9 (via le pont WS↔TLS natif) ─────────────────────

const SMP_V9_KEY = 'nephtys_smp_v9_enabled';
const SMP_V9_URL_KEY = 'nephtys_smp_v9_bridge_url';
const SMP_V9_HOST_KEY = 'nephtys_smp_v9_host';

/** Relais SMP proposés par défaut (sélectionnables dans Serveurs et réseaux). */
export function getSmpRelayPresets(): string[] {
  return SMP_RELAY_PRESETS;
}

/** Relais SMP sélectionné (host), défaut = premier preset. */
export function getSmpV9Host(): string {
  try {
    const o = localStorage.getItem(SMP_V9_HOST_KEY);
    if (o) return o;
  } catch {
    // localStorage indisponible
  }
  return (import.meta.env.VITE_SMP_RELAY_HOST as string | undefined)?.trim() || SMP_RELAY_PRESETS[0];
}

/** Sélectionne le relais SMP. Prend effet à la prochaine connexion. */
export function setSmpV9Host(host: string): void {
  try {
    const h = host.trim();
    if (h) localStorage.setItem(SMP_V9_HOST_KEY, h);
    else localStorage.removeItem(SMP_V9_HOST_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * URL du **pont** WebSocket↔TLS auto-hébergé (ex. `wss://vps/smp`).
 *
 * **Transport interne uniquement** : le pont est invisible par construction et
 * ne doit jamais être affiché comme un « relais » (`getAvailableRelays` l'exclut,
 * l'UI ne le rend pas). Utilisé en interne par `SmpV9Wire` (`bridgeUrl`).
 *
 * Priorité : override local, puis `VITE_SMP_V9_BRIDGE_URL` / `VITE_SMP_BRIDGE_URL`,
 * puis le pont auto-hébergé par défaut.
 */
export function getSmpBridgeUrl(): string {
  try {
    const o = localStorage.getItem(SMP_V9_URL_KEY);
    if (o) return o.trim();
  } catch {
    // localStorage indisponible
  }
  return (
    (import.meta.env.VITE_SMP_V9_BRIDGE_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_SMP_BRIDGE_URL as string | undefined)?.trim() ||
    'wss://78-232-3-78.sslip.io/simplex'
  );
}

/** Alias interne de {@link getSmpBridgeUrl} (compat historique). */
export function getSmpV9BridgeUrl(): string {
  return getSmpBridgeUrl();
}

/** Enregistre l'URL du pont SMP v9. */
export function setSmpV9BridgeUrl(url: string): void {
  try {
    const v = url.trim();
    if (v) localStorage.setItem(SMP_V9_URL_KEY, v);
    else localStorage.removeItem(SMP_V9_URL_KEY);
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

/**
 * Vrai si le transport SMP est actif. **Activé par défaut** (le mode privé
 * route via le réseau SMP officiel) ; l'utilisateur peut le désactiver
 * explicitement (valeur '0'), ou le désactiver en vidant l'URL du pont.
 */
export function isSmpV9Enabled(): boolean {
  try {
    const v = localStorage.getItem(SMP_V9_KEY);
    const on = v === null ? true : v === '1';
    return on && Boolean(getSmpV9BridgeUrl());
  } catch {
    return Boolean(getSmpV9BridgeUrl());
  }
}

export function setSmpV9Enabled(enabled: boolean): void {
  try {
    localStorage.setItem(SMP_V9_KEY, enabled ? '1' : '0');
  } catch {
    // localStorage indisponible
  }
  instance = null;
}

export interface PrivateRelayWireSelection {
  wire: RelayWire;
  /** Repli actif (SMP/Tor → Supabase anon), pour l'UI de transport dégradé. */
  failover: FailoverRelayWire | null;
}

/**
 * Sélectionne le wire de transport privé selon la configuration courante
 * (Tor, SMP, agent, réseau SMP v9, relais custom, défaut SMP → repli).
 *
 * Extrait de `getPrivateMessenger` pour être testable sans instancier le
 * `PrivateMessenger` (IndexedDB, ratchet, …).
 */
export function createPrivateRelayWire(): PrivateRelayWireSelection {
  const mode = import.meta.env.VITE_RELAY_MODE as string | undefined;
  const smpUrl =
    (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
  const smpKeyHash = import.meta.env.VITE_SMP_RELAY_KEY_HASH as string | undefined;
  let wire: RelayWire;
  let failover: FailoverRelayWire | null = null;

  if (isTorRelayEnabled()) {
    // Mode Tor WASM : client Tor DANS le navigateur (tor-js). Le transport
    // SMP-over-Tor cible le **relais `.onion`** configuré
    // (`getOnionRelayUrl` → `http://<…>.onion/smp/up|down`) — jamais le relais
    // clearnet de l'opérateur.
    //
    // L'URL passée à `SmpRelayWire` n'est qu'un marqueur : le socket fantôme
    // Tor ignore l'URL et utilise la `.onion` (ci-dessous, via la fabrique).
    const onion = getOnionRelayUrl();
    const torWire = new SmpRelayWire({
      url: 'wss://tor.gateway/',
      keyHash: '',
      webSocketImplFactory: () => createTorWebSocketImpl(onion),
    });
    // CHAÎNE DE REPLI : le mode privé reste en **SMP** dès qu'un relais SMP est
    // joignable ; Supabase n'est que le DERNIER recours :
    //   1. SMP-over-Tor (relais `.onion`) — prioritaire pour ne pas exposer l'IP
    //      tant que Tor fonctionne ;
    //   2. SMP clair (réseau SMP anonyme via le pont `/simplex`) si l'`.onion`
    //      est injoignable ;
    //   3. relais aveugle Supabase (`anon`, sans session) en dernier recours.
    // Chaque bascule est signalée comme « transport dégradé » via
    // `onFallbackChange` (`isRelayFallbackActive` / `onRelayTransportChange`).
    const clearnetSmp = new SmpV9Wire({ bridgeUrl: getSmpBridgeUrl(), host: getSmpV9Host() });
    const inner = new FailoverRelayWire(
      clearnetSmp,
      new SupabaseRelayWire(),
      active => { for (const cb of transportListeners) cb(active); },
      { hedgeMs: PRIMARY_HEDGE_MS },
    );
    const fw = new FailoverRelayWire(
      torWire,
      inner,
      active => { for (const cb of transportListeners) cb(active); },
      { hedgeMs: PRIMARY_HEDGE_MS },
    );
    failover = fw;
    wire = fw;
  } else if (mode === 'smp') {
    // Relais SMP SMP (browser-profile) — OPTION EXPLICITE.
    // ⚠️ WIP : l'adaptateur SmpRelayWire ne couvre pas encore le modèle de
    // connexion à deux files du mode privé ; à finaliser avant usage prod.
    wire = new SmpRelayWire({ url: smpUrl, keyHash: smpKeyHash });
  } else if (mode === 'smp-agent') {
    wire = new AgentRelayWire(AGENT_URL);
  } else if (isSmpV9Enabled()) {
    // Réseau SMP (protocole SMP v9..v15) via le pont WS↔TLS natif (transport
    // interne, invisible), avec repli sur le relais aveugle si le pont/le
    // serveur SMP est injoignable. Le secondaire est le client **anon** (sans
    // session) → la connexion réussit même si le pont est down.
    const fw = new FailoverRelayWire(
      new SmpV9Wire({ bridgeUrl: getSmpBridgeUrl(), host: getSmpV9Host() }),
      new SupabaseRelayWire(),
      active => { for (const cb of transportListeners) cb(active); },
      { hedgeMs: PRIMARY_HEDGE_MS },
    );
    failover = fw;
    wire = fw;
  } else if (hasCustomRelay()) {
    wire = new WebSocketWire(getRelayUrl());
  } else {
    // DÉFAUT : SMP (SMP browser-profile) PRIORITAIRE, repli automatique sur
    // le relais aveugle Supabase (client anon) si le premier est injoignable →
    // le mode privé fonctionne toujours. (Un relais local traînant est ignoré.)
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
      { hedgeMs: PRIMARY_HEDGE_MS },
    );
    failover = fw;
    wire = fw;
  }

  return { wire, failover };
}

/**
 * Préchauffe le transport privé (best-effort, aucun effet observable) : démarre
 * le bootstrap du client Tor WASM si le mode Tor est actif, afin que la création
 * d'une connexion privée ne l'attende pas. À appeler au montage de la page
 * privée. Ne lève jamais.
 */
export function warmupPrivateRelay(): void {
  if (!isTorRelayEnabled()) return;
  void getTorClient().catch(() => { /* best-effort */ });
}

export function getPrivateMessenger(): PrivateMessenger {
  if (!instance) {
    const { wire, failover } = createPrivateRelayWire();
    failoverWire = failover;
    instance = new PrivateMessenger(
      wire,
      new IdbConnectionStore(),
      undefined,
      new IdbHistoryStore(),
    );
  }
  return instance;
}
