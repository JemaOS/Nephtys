// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Point d'entrée client du mode privé anonyme.
 *
 * Un seul `PrivateMessenger` (et son magasin de connexions local) par session,
 * pointé sur le relais `VITE_RELAY_URL`.
 */

import { WebSocketWire } from './wire';
import { PrivateMessenger } from './privateMessenger';
import { IdbConnectionStore } from './connectionStore';
import { IdbHistoryStore } from './historyStore';

let instance: PrivateMessenger | null = null;

const RELAY_OVERRIDE_KEY = 'nephtys_relay_url';

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

/**
 * Change le relais à chaud (ex. `wss://xxxx.onion`). Prend effet à la
 * prochaine création de connexion (ou après rechargement de la page).
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
    instance = new PrivateMessenger(
      new WebSocketWire(getRelayUrl()),
      new IdbConnectionStore(),
      undefined,
      new IdbHistoryStore(),
    );
  }
  return instance;
}
