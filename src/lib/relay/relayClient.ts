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

/**
 * Vrai si un relais WebSocket dédié est configuré (override à chaud ou env).
 * Sinon, on utilise le **relais aveugle sur Supabase** (aucun serveur requis).
 */
export function hasCustomRelay(): boolean {
  try {
    if (localStorage.getItem(RELAY_OVERRIDE_KEY)) return true;
  } catch {
    // localStorage indisponible
  }
  return !!(import.meta.env.VITE_RELAY_URL as string | undefined);
}

/**
 * URL du relais. Priorité :
 *   1. override « à chaud » (localStorage) — permet de basculer sur un relais
 *      `.onion` (Tor) sans rebuilder ;
 *   2. `VITE_RELAY_URL` (au build) ;
 *   3. défaut local (développement).
 */
export function getRelayUrl(): string {
  try {
    const override = localStorage.getItem(RELAY_OVERRIDE_KEY);
    if (override) return override;
  } catch {
    // localStorage indisponible → on ignore l'override
  }
  return (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'ws://127.0.0.1:8090';
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
    let wire: RelayWire;
    if (mode === 'simplex-agent' || (mode === undefined && agentReachable)) {
      // Voie A : le mode privé passe par l'agent SimpleX (relais SMP publics).
      // Priorité : mode explicite, sinon agent détecté automatiquement.
      wire = new AgentRelayWire(AGENT_URL);
    } else if (hasCustomRelay()) {
      wire = new WebSocketWire(getRelayUrl());
    } else {
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
