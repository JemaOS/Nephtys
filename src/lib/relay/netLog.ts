// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the project root.

/**
 * Journal d'activité RÉSEAU (mode privé) — anneau borné en mémoire, observable.
 *
 * Chaque couche (Tor, SMP, SMP v9, Supabase, XFTP, chaîne de repli) publie des
 * événements via `netLog()`. La page « Réseau » s'y abonne pour un suivi EN
 * TEMPS RÉEL de ce qui se passe quand l'utilisateur agit (création de connexion,
 * envoi, repli de transport…).
 *
 * Contraintes de perf (le « plus optimisé possible ») :
 *   • buffer circulaire borné (`MAX_EVENTS`) → mémoire constante ;
 *   • `netLog()` est O(1), sans sérialisation ni I/O ;
 *   • s'il n'y a aucun abonné, le coût se limite à un `push` (les écouteurs vivent
 *     dans un `Set`).
 * Rien n'est envoyé au serveur : tout reste local à l'appareil.
 */

export type NetStatus = 'start' | 'ok' | 'fail' | 'fallback';

export type NetLayer = 'tor' | 'smp' | 'smp-v9' | 'supabase' | 'xftp' | 'relay';

export interface NetEvent {
  /** Identifiant monotone (clé de rendu stable). */
  id: number;
  /** Horodatage (ms epoch). */
  t: number;
  layer: NetLayer;
  op: string;
  status: NetStatus;
  /** Destination (URL / hôte / relais), si connue. */
  endpoint?: string;
  /** Détail (message d'erreur, raison d'un repli…). */
  detail?: string;
  /** Durée de l'opération (ms), si mesurée. */
  ms?: number;
}

const MAX_EVENTS = 400;

let seq = 0;
const events: NetEvent[] = [];
const listeners = new Set<(e: NetEvent) => void>();

/** Publie un événement (best-effort : ne lève jamais). */
export function netLog(ev: Omit<NetEvent, 'id' | 't'> & { t?: number }): void {
  const e: NetEvent = {
    id: ++seq,
    t: ev.t ?? Date.now(),
    layer: ev.layer,
    op: ev.op,
    status: ev.status,
    endpoint: ev.endpoint,
    detail: ev.detail,
    ms: ev.ms,
  };
  events.push(e);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (listeners.size === 0) return;
  for (const l of listeners) {
    try {
      l(e);
    } catch {
      // Un abonné défaillant ne doit jamais perturber le réseau ni les autres.
    }
  }
}

/** Copie du journal, du plus ancien au plus récent. */
export function netLogSnapshot(): NetEvent[] {
  return events.slice();
}

/** S'abonne aux nouveaux événements ; renvoie la fonction de désabonnement. */
export function netLogSubscribe(cb: (e: NetEvent) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Vide le journal. */
export function netLogClear(): void {
  events.length = 0;
}

/** Nombre d'événements conservés (diagnostic/tests). */
export function netLogSize(): number {
  return events.length;
}
