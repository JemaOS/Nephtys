// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * `FailoverRelayWire` — relais **prioritaire** avec **repli temporaire**, routé
 * **par file**.
 *
 * Le mode privé tente d'abord `primary` ; si la **création d'une nouvelle
 * file** échoue (relais injoignable / non prêt), on crée cette file sur
 * `secondary` **pendant un temps limité** (cooldown), puis on re-tente le
 * primaire. On ne condamne donc JAMAIS le primaire à vie : un échec transitoire
 * (redémarrage, réseau) ne bloque pas le mode privé jusqu'au prochain
 * rechargement.
 *
 * ⚠️ Correctif split-brain : le repli n'est **pas** un état global qui déplace
 * toutes les opérations. Chaque file est **taggée avec le relais qui l'héberge**
 * (`relay` dans les `QueueCredentials`, propagé dans les références de file et
 * l'invitation par `RelayTransport`) ; toutes les opérations ultérieures sur
 * cette file sont routées vers **son** relais, que le primaire soit up ou down.
 *   • Un échec du primaire ne détourne plus les files hébergées sur le primaire.
 *   • Une file créée en repli reste joignable après le retour du primaire.
 *   • Un `relay` demandé absent du pool → **erreur explicite** (jamais de repli
 *     silencieux sur le primaire).
 */

import type { RelayOp, RelayResponse, RelayWire } from './wire';

const PRIMARY_COOLDOWN_MS = 30_000;

/** Wire exposant les tags `relay` des files qu'il héberge (routage par file). */
interface RelayIdAware {
  readonly relayIds?: string[];
}

export class FailoverRelayWire implements RelayWire {
  private primaryFailed = false;
  private retryPrimaryAt = 0;

  constructor(
    private readonly primary: RelayWire,
    private readonly secondary: RelayWire,
    /** Notifié quand on bascule sur le relais de repli (état dégradé). */
    private readonly onFallbackChange?: (active: boolean) => void,
  ) {}

  /** Vrai si le relais prioritaire est actuellement en repli. */
  get onFallback(): boolean {
    return this.primaryFailed;
  }

  private static idsOf(wire: RelayWire): string[] {
    return (wire as RelayIdAware).relayIds ?? [];
  }

  /**
   * Relais qui héberge une file d'après son tag `relay`. `undefined` (file
   * héritée, sans tag) → primaire ; tag inconnu → `null` (→ erreur explicite).
   */
  private wireFor(relay?: string): RelayWire | null {
    if (relay === undefined) return this.primary;
    if (FailoverRelayWire.idsOf(this.primary).includes(relay)) return this.primary;
    if (FailoverRelayWire.idsOf(this.secondary).includes(relay)) return this.secondary;
    return null;
  }

  private restorePrimary(): void {
    this.primaryFailed = false;
    this.retryPrimaryAt = 0;
    this.onFallbackChange?.(false);
  }

  private async createQueue(): Promise<RelayResponse> {
    // Re-tenter le primaire après le cooldown (échec probablement transitoire).
    if (this.primaryFailed && Date.now() >= this.retryPrimaryAt) {
      this.restorePrimary();
    }
    if (!this.primaryFailed) {
      let resp: RelayResponse;
      try {
        resp = await this.primary.request({ op: 'createQueue' });
      } catch {
        resp = { ok: false, error: 'primary threw' };
      }
      if (resp.ok && resp.result) return resp;

      // Échec du relais prioritaire → repli TEMPORAIRE pour les NOUVELLES files.
      console.warn('[relay] relais prioritaire indisponible → repli temporaire:', resp.error);
      this.primaryFailed = true;
      this.retryPrimaryAt = Date.now() + PRIMARY_COOLDOWN_MS;
      this.onFallbackChange?.(true);
    }
    return this.secondary.request({ op: 'createQueue' });
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    // Le repli ne décide QUE de l'hébergement des nouvelles files : on ne
    // bascule donc qu'à la création.
    if (op.op === 'createQueue') return this.createQueue();

    const wire = this.wireFor(op.relay);
    if (!wire) {
      return { ok: false, error: `relais inconnu (hors pool): ${op.relay}` };
    }
    return wire.request(op);
  }

  /** Relais prioritaire (diagnostic) — quelle que soit la file. */
  get primaryWire(): RelayWire {
    return this.primary;
  }

  /** Relais de repli (diagnostic). */
  get secondaryWire(): RelayWire {
    return this.secondary;
  }

  /** Relais actuellement préféré pour la création de files (diagnostic). */
  get activeWire(): RelayWire {
    return this.primaryFailed ? this.secondary : this.primary;
  }
}
