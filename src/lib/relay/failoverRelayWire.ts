// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * `FailoverRelayWire` — relais **prioritaire** avec **repli**.
 *
 * Le mode privé tente d'abord `primary` (ex. relais SimpleX SMP navigateur) ;
 * si la toute première opération échoue (relais injoignable / non prêt), on
 * bascule **définitivement** sur `secondary` (ex. relais aveugle Supabase) pour
 * ne jamais laisser l'utilisateur sans messagerie.
 *
 * ⚠️ Le basculement n'est propre que s'il intervient **avant** toute création de
 * file (sinon l'état est réparti entre deux relais). En usage réel, l'échec se
 * produit à la création de connexion → bascule avant tout état.
 */

import type { RelayOp, RelayResponse, RelayWire } from './wire';

export class FailoverRelayWire implements RelayWire {
  private active: RelayWire;
  private primaryFailed = false;

  constructor(
    private readonly primary: RelayWire,
    private readonly secondary: RelayWire,
  ) {
    this.active = primary;
  }

  /** Vrai si le relais prioritaire a été abandonné (repli actif). */
  get onFallback(): boolean {
    return this.primaryFailed;
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    if (this.primaryFailed) return this.secondary.request(op);
    let resp: RelayResponse;
    try {
      resp = await this.primary.request(op);
    } catch {
      resp = { ok: false, error: 'primary threw' };
    }
    if (resp.ok) return resp;
    // Échec du relais prioritaire → on bascule définitivement.
    console.warn('[relay] relais prioritaire indisponible → repli:', resp.error);
    this.primaryFailed = true;
    this.active = this.secondary;
    return this.secondary.request(op);
  }

  /** Relais actuellement utilisé (diagnostic). */
  get activeWire(): RelayWire {
    return this.active;
  }
}
