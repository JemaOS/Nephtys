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

/** URL du relais (self-hosted ou .onion pour Tor). */
export function getRelayUrl(): string {
  return (import.meta.env.VITE_RELAY_URL as string | undefined) ?? 'ws://127.0.0.1:8090';
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
