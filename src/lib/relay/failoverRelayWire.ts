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
import { netLog } from './netLog';

const PRIMARY_COOLDOWN_MS = 30_000;

/** Wire exposant les tags `relay` des files qu'il héberge (routage par file). */
interface RelayIdAware {
  readonly relayIds?: string[];
}

export interface FailoverOptions {
  /**
   * Budget (ms) accordé au relais **prioritaire** pour créer une file avant de
   * démarrer le repli **en parallèle** (course « le premier à réussir gagne »).
   * `0` (défaut) = comportement historique (attendre le primaire jusqu'au bout).
   *
   * Sert à BORNER la latence quand le primaire est lent à s'établir (ex. client
   * Tor WASM en cours de bootstrap, pont SMP lent) : la connexion privée se crée
   * sur le repli en quelques secondes au lieu d'attendre le timeout complet.
   */
  hedgeMs?: number;
}

export class FailoverRelayWire implements RelayWire {
  private primaryFailed = false;
  private retryPrimaryAt = 0;

  constructor(
    private readonly primary: RelayWire,
    private readonly secondary: RelayWire,
    /** Notifié quand on bascule sur le relais de repli (état dégradé). */
    private readonly onFallbackChange?: (active: boolean) => void,
    private readonly options: FailoverOptions = {},
  ) {}

  private get hedgeMs(): number {
    return Math.max(0, this.options.hedgeMs ?? 0);
  }

  /** Vrai si le relais prioritaire est actuellement en repli. */
  get onFallback(): boolean {
    return this.primaryFailed;
  }

  /**
   * Tags des files hébergées par ce chaînage (primaire + secondaire). Permet
   * d'imbriquer un `FailoverRelayWire` comme secondaire d'un autre (ex. chaîne
   * `<SMP-over-Tor> → <SMP clair → Supabase>`) tout en gardant le routage par
   * file vers le bon relais.
   */
  get relayIds(): string[] {
    return [...FailoverRelayWire.idsOf(this.primary), ...FailoverRelayWire.idsOf(this.secondary)];
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

  private markPrimaryDown(reason?: string): void {
    // Échec du relais prioritaire → repli TEMPORAIRE pour les NOUVELLES files.
    console.warn('[relay] relais prioritaire indisponible → repli temporaire:', reason);
    netLog({ layer: 'relay', op: 'fallback', status: 'fallback', detail: reason });
    this.primaryFailed = true;
    this.retryPrimaryAt = Date.now() + PRIMARY_COOLDOWN_MS;
    this.onFallbackChange?.(true);
  }

  private primaryCreate(): Promise<RelayResponse> {
    return this.primary
      .request({ op: 'createQueue' })
      .catch(() => ({ ok: false, error: 'primary threw' }) as RelayResponse);
  }

  private async createQueue(): Promise<RelayResponse> {
    // Re-tenter le primaire après le cooldown (échec probablement transitoire).
    if (this.primaryFailed && Date.now() >= this.retryPrimaryAt) {
      this.restorePrimary();
    }
    // Déjà en repli : pas de course, on va droit au secondaire.
    if (this.primaryFailed) {
      return this.secondary.request({ op: 'createQueue' });
    }

    const hedgeMs = this.hedgeMs;
    // Comportement historique : on attend le primaire jusqu'au bout.
    if (hedgeMs <= 0) {
      const resp = await this.primaryCreate();
      if (resp.ok && resp.result) return resp;
      this.markPrimaryDown(resp.error);
      return this.secondary.request({ op: 'createQueue' });
    }

    // Course bornée : le primaire a `hedgeMs` d'avance ; le repli est démarré dès
    // que le primaire échoue OU que le budget expire. Le premier succès gagne — le
    // primaire reste préféré s'il répond à temps. Borne la latence quand le
    // primaire est lent à s'établir (bootstrap Tor, pont SMP lent).
    return await new Promise<RelayResponse>((resolve) => {
      let settled = false;
      let secondaryStarted = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const finish = (resp: RelayResponse, primaryWon: boolean): void => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (!primaryWon) this.markPrimaryDown(resp.error);
        resolve(resp);
      };

      const startSecondary = (): void => {
        if (secondaryStarted) return;
        secondaryStarted = true;
        void this.secondary.request({ op: 'createQueue' }).then(
          resp => finish(resp, false),
          () => finish({ ok: false, error: 'secondary threw' }, false),
        );
      };

      timer = setTimeout(startSecondary, hedgeMs);

      void this.primaryCreate().then(resp => {
        // Le primaire a répondu à temps : il gagne.
        if (resp.ok && resp.result) { finish(resp, true); return; }
        // Échec du primaire avant le budget → démarrer le repli immédiatement.
        startSecondary();
      });
    });
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
