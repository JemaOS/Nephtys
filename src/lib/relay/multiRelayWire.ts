// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * MultiRelayWire — **repartition des files sur plusieurs relais**
 * (decentralisation facon SimpleX).
 *
 * Chaque **nouvelle file** du mode prive est creee sur un relais choisi en
 * **round-robin** ; toutes les operations suivantes sur cette file sont routees
 * vers le relais qui l'heberge. Le relais est **stocke dans la reference de
 * file** (`relay`), donc il survit au rechargement et se propage via
 * l'invitation → le pair sait sur quel relais lire/ecrire.
 *
 * Si un relais est injoignable a la creation, on essaie le suivant du pool.
 */

import type { QueueCredentials } from './relayCore';
import type { RelayOp, RelayResponse, RelayWire } from './wire';

export interface RelayEntry {
  url: string;
  wire: RelayWire;
}

export class MultiRelayWire implements RelayWire {
  private rr = 0;

  constructor(private readonly entries: RelayEntry[]) {
    if (entries.length === 0) throw new Error('MultiRelayWire: aucun relais configure');
  }

  private wireFor(relay?: string): RelayWire {
    if (relay) {
      const match = this.entries.find(e => e.url === relay);
      if (match) return match.wire;
    }
    return this.entries[0].wire;
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    if (op.op === 'createQueue') {
      // Round-robin + repli : on essaie les relais a partir du pointeur courant.
      for (let i = 0; i < this.entries.length; i++) {
        const chosen = this.entries[(this.rr + i) % this.entries.length];
        try {
          const resp = await chosen.wire.request(op);
          if (resp.ok && resp.result) {
            this.rr += i + 1;
            const cred = resp.result as QueueCredentials;
            // On tague la file avec le relais qui l'heberge.
            return { ok: true, result: { ...cred, relay: chosen.url } };
          }
        } catch {
          // relais suivant
        }
      }
      return { ok: false, error: 'reseau decentralise : tous les relais ont echoue' };
    }

    // Operations sur une file : router vers le relais qui l'heberge.
    return this.wireFor((op as { relay?: string }).relay).request(op);
  }

  /** URLs des relais du pool (diagnostic). */
  get relays(): string[] {
    return this.entries.map(e => e.url);
  }
}
