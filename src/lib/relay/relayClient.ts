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

export function getPrivateMessenger(): PrivateMessenger {
  if (!instance) {
    const mode = import.meta.env.VITE_RELAY_MODE as string | undefined;
    const smpUrl =
      (import.meta.env.VITE_SMP_RELAY_URL as string | undefined) ?? 'wss://78-232-3-78.sslip.io/';
    const smpKeyHash = import.meta.env.VITE_SMP_RELAY_KEY_HASH as string | undefined;
    let wire: RelayWire;
    if (mode === 'simplex-smp') {
      // Relais SimpleX SMP (browser-profile) — OPTION EXPLICITE.
      // ⚠️ WIP : l'adaptateur SmpRelayWire ne couvre pas encore le modèle de
      // connexion à deux files du mode privé ; à finaliser avant usage prod.
      wire = new SmpRelayWire({ url: smpUrl, keyHash: smpKeyHash });
    } else if (mode === 'simplex-agent') {
      wire = new AgentRelayWire(AGENT_URL);
    } else if (hasCustomRelay()) {
      wire = new WebSocketWire(getRelayUrl());
    } else {
      // DÉFAUT (fonctionnel) : relais aveugle hébergé sur Supabase — aucune
      // config requise, un relais LOCAL (127.0.0.1) traînant est ignored.
      wire = new SupabaseRelayWire();
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
