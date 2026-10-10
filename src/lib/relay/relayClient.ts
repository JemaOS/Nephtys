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
    if (mode === 'simplex-agent') {
      // Voie A : le mode privé passe par l'agent SimpleX (relais SMP publics).
      // Prérequis : l'agent `simplex-chat` doit être en écoute (VITE_SMP_AGENT_URL).
      wire = new AgentRelayWire(
        (import.meta.env.VITE_SMP_AGENT_URL as string | undefined) ?? 'ws://127.0.0.1:5225',
      );
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
