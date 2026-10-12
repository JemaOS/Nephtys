// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * MultiRelayWire — **repartition des files sur plusieurs relais**
 * (decentralisation facon SMP).
 *
 * Chaque **nouvelle file** du mode prive est creee sur un relais choisi en
 * **round-robin** ; toutes les operations suivantes sur cette file sont routees
 * vers le relais qui l'heberge. Le relais est **stocke dans la reference de
 * file** (`relay`), donc il survit au rechargement et se propage via
 * l'invitation → le pair sait sur quel relais lire/ecrire.
 *
 * Si un relais est injoignable a la creation, on essaie le suivant du pool.
 *
 * ⚠️ Une operation portant un tag `relay` **absent du pool** est une erreur
 * explicite : on ne route jamais silencieusement une file inconnue vers
 * `entries[0]` (cela masquerait une file mal taggée / un relais retiré).
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

  /**
   * Relais qui heberge une file. `undefined` (file heritee, sans tag) →
   * `entries[0]` ; tag inconnu → `null` (→ erreur explicite, voir `request`).
   */
  private wireFor(relay?: string): RelayWire | null {
    if (relay) {
      const match = this.entries.find(e => e.url === relay);
      return match ? match.wire : null;
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
    const relay = (op as { relay?: string }).relay;
    const wire = this.wireFor(relay);
    if (!wire) return { ok: false, error: `relais inconnu (hors pool): ${relay}` };
    return wire.request(op);
  }

  /** URLs des relais du pool (diagnostic). */
  get relays(): string[] {
    return this.entries.map(e => e.url);
  }

  /** Tags `relay` des files hebergees par ce wire (routage par file). */
  get relayIds(): string[] {
    return this.entries.map(e => e.url);
  }
}
