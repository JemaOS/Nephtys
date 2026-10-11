// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * `FailoverRelayWire` — relais **prioritaire** avec **repli temporaire**.
 *
 * Le mode privé tente d'abord `primary` ; si une requête échoue (relais
 * injoignable / non prêt), on bascule sur `secondary` **pour un temps limité**
 * (cooldown), puis on **re-tente le primaire**. On ne condamne donc JAMAIS le
 * primaire à vie : un échec transitoire (redémarrage, réseau) ne bloque pas le
 * mode privé jusqu'au prochain rechargement.
 *
 * ⚠️ Le basculement reste propre tant qu'il intervient avant la création d'une
 * file ; après, une file vit sur son relais (le repli ne la « déplace » pas).
 */

import type { RelayOp, RelayResponse, RelayWire } from './wire';

const PRIMARY_COOLDOWN_MS = 30_000;

export class FailoverRelayWire implements RelayWire {
  private active: RelayWire;
  private primaryFailed = false;
  private retryPrimaryAt = 0;

  constructor(
    private readonly primary: RelayWire,
    private readonly secondary: RelayWire,
    /** Notifié quand on bascule sur le relais de repli (état dégradé). */
    private readonly onFallbackChange?: (active: boolean) => void,
  ) {
    this.active = primary;
  }

  /** Vrai si le relais prioritaire est actuellement en repli. */
  get onFallback(): boolean {
    return this.primaryFailed;
  }

  private restorePrimary(): void {
    this.primaryFailed = false;
    this.active = this.primary;
    this.onFallbackChange?.(false);
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    // Re-tenter le primaire après le cooldown (échec probablement transitoire).
    if (this.primaryFailed && Date.now() >= this.retryPrimaryAt) {
      this.restorePrimary();
    }
    if (this.primaryFailed) return this.secondary.request(op);

    let resp: RelayResponse;
    try {
      resp = await this.primary.request(op);
    } catch {
      resp = { ok: false, error: 'primary threw' };
    }
    if (resp.ok) return resp;

    // Échec du relais prioritaire → repli TEMPORAIRE.
    console.warn('[relay] relais prioritaire indisponible → repli temporaire:', resp.error);
    this.primaryFailed = true;
    this.retryPrimaryAt = Date.now() + PRIMARY_COOLDOWN_MS;
    this.active = this.secondary;
    this.onFallbackChange?.(true);
    return this.secondary.request(op);
  }

  /** Relais actuellement utilisé (diagnostic). */
  get activeWire(): RelayWire {
    return this.active;
  }
}
