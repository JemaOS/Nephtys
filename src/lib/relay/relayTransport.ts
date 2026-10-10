// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Transport de messagerie adossé au relais auto-hébergeable.
 *
 * Modèle SimpleX : une « connexion » = deux files unidirectionnelles.
 *   • `createConnection()` génère la paire de files et renvoie une
 *     **invitation** à transmettre hors-bande (QR/lien).
 *   • `acceptInvite()` enregistre la connexion miroir côté pair.
 *   • `sendMessage` dépose le ciphertext dans la file d'envoi du pair ;
 *     `subscribe` lit la file de réception et acquitte.
 *   • `createReceiveQueue()` / `addReceiveQueue()` / `removeReceiveQueue()`
 *     permettent la **rotation de file** (limiter la corrélation longue
 *     durée) : on ajoute une nouvelle file de réception et on laisse
 *     l'ancienne s'écouler (grâce) avant de la supprimer.
 *
 * Le relais ne voit ni expéditeur, ni destinataire, ni contenu en clair.
 */

import type {
  IncomingMessage,
  MessagingTransport,
  OutgoingMessage,
  SendResult,
  Unsubscribe,
} from '../transport/types';
import type { QueueCredentials, StoredEnvelope } from './relayCore';
import type { RelayWire } from './wire';

export interface RelayQueueRef {
  queueId: string;
  queueKey: string;
}

export interface RelayConnection {
  rcvQueue: RelayQueueRef;
  sendQueue: RelayQueueRef;
}

interface Invite {
  rcvQueue: RelayQueueRef;
  sendQueue: RelayQueueRef;
}

interface ConnectionState {
  sendQueue: RelayQueueRef;
  rcvQueues: RelayQueueRef[];
}

export function encodeInvite(invite: Invite): string {
  return btoa(JSON.stringify(invite)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeInvite(link: string): Invite {
  let b64 = link.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  return JSON.parse(atob(b64)) as Invite;
}

export class RelayTransport implements MessagingTransport {
  readonly kind = 'relay';

  private readonly connections = new Map<string, ConnectionState>();

  constructor(
    private readonly wire: RelayWire,
    private readonly pollMs = 3000,
  ) {}

  registerConnection(conversationId: string, connection: RelayConnection): void {
    this.connections.set(conversationId, {
      sendQueue: connection.sendQueue,
      rcvQueues: [connection.rcvQueue],
    });
  }

  connectionFor(conversationId: string): RelayConnection | undefined {
    const state = this.connections.get(conversationId);
    if (!state) return undefined;
    return { sendQueue: state.sendQueue, rcvQueue: state.rcvQueues.at(-1)! };
  }

  private async createQueue(): Promise<QueueCredentials> {
    const resp = await this.wire.request({ op: 'createQueue' });
    if (!resp.ok || !resp.result) throw new Error('Relay: création de file échouée');
    return resp.result as QueueCredentials;
  }

  /** Crée la paire de files ; renvoie la connexion locale + l'invitation à partager. */
  async createConnection(): Promise<{ connection: RelayConnection; invite: string }> {
    const inbound = await this.createQueue();  // on lit ici (rcvKey), le pair y écrit (sendKey)
    const outbound = await this.createQueue(); // le pair lit ici (rcvKey), on y écrit (sendKey)

    const connection: RelayConnection = {
      rcvQueue: { queueId: inbound.queueId, queueKey: inbound.rcvKey },
      sendQueue: { queueId: outbound.queueId, queueKey: outbound.sendKey },
    };
    const invite: Invite = {
      rcvQueue: { queueId: outbound.queueId, queueKey: outbound.rcvKey },
      sendQueue: { queueId: inbound.queueId, queueKey: inbound.sendKey },
    };
    return { connection, invite: encodeInvite(invite) };
  }

  /**
   * Crée une nouvelle file de réception pour ce côté :
   *   • `ourRcv`  : notre référence locale (queueId + rcvKey) à interroger ;
   *   • `peerRef` : ce que le pair doit utiliser pour nous écrire (queueId + sendKey).
   * Utilisé par la rotation de file.
   */
  async createReceiveQueue(): Promise<{ ourRcv: RelayQueueRef; peerRef: RelayQueueRef }> {
    const queue = await this.createQueue();
    return {
      ourRcv: { queueId: queue.queueId, queueKey: queue.rcvKey },
      peerRef: { queueId: queue.queueId, queueKey: queue.sendKey },
    };
  }

  /** Ajoute une file de réception à interroger (rotation). */
  addReceiveQueue(conversationId: string, ref: RelayQueueRef): void {
    const state = this.connections.get(conversationId);
    if (state && !state.rcvQueues.some(q => q.queueId === ref.queueId)) {
      state.rcvQueues.push(ref);
    }
  }

  /** Change la file d'envoi cible (après une rotation demandée par le pair). */
  setSendQueue(conversationId: string, ref: RelayQueueRef): void {
    const state = this.connections.get(conversationId);
    if (state) state.sendQueue = ref;
  }

  /**
   * Retire une file de réception de l'interrogation. Si `deleteOnRelay`,
   * supprime aussi la file côté relais (après la période de grâce).
   */
  async removeReceiveQueue(conversationId: string, ref: RelayQueueRef, deleteOnRelay = false): Promise<void> {
    const state = this.connections.get(conversationId);
    if (state) {
      state.rcvQueues = state.rcvQueues.filter(q => q.queueId !== ref.queueId);
    }
    if (deleteOnRelay) {
      try {
        await this.wire.request({ op: 'delete', queueId: ref.queueId, queueKey: ref.queueKey });
      } catch {
        // best-effort : la file expirera d'elle-même (TTL)
      }
    }
  }

  /** Enregistre la connexion miroir à partir d'une invitation reçue. */
  acceptInvite(conversationId: string, invite: string): RelayConnection {
    const decoded = decodeInvite(invite);
    const connection: RelayConnection = {
      rcvQueue: decoded.rcvQueue,
      sendQueue: decoded.sendQueue,
    };
    this.registerConnection(conversationId, connection);
    return connection;
  }

  async sendMessage(msg: OutgoingMessage): Promise<SendResult> {
    const state = this.connections.get(msg.conversationId);
    if (!state) throw new Error('Relay: aucune connexion pour cette conversation');
    const resp = await this.wire.request({
      op: 'send',
      queueId: state.sendQueue.queueId,
      queueKey: state.sendQueue.queueKey,
      ciphertext: msg.content,
    });
    if (!resp.ok || !resp.result) {
      throw new Error(`Relay: envoi refusé (${resp.error ?? 'inconnu'})`);
    }
    const { id } = resp.result as { id: string };
    return { id, raw: { id } };
  }

  subscribe(conversationId: string, onMessage: (msg: IncomingMessage) => void): Unsubscribe {
    const state = this.connections.get(conversationId);
    if (!state) {
      // Ne jamais faire planter l'UI : on ignore silencieusement si la
      // connexion n'est pas (encore) enregistrée.
      console.warn('Relay: aucune connexion pour cette conversation (abonnement ignoré)');
      return () => {};
    }

    let stopped = false;
    let inFlight = false;

    const tick = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        for (const queue of [...state.rcvQueues]) {
          const resp = await this.wire.request({
            op: 'read',
            queueId: queue.queueId,
            queueKey: queue.queueKey,
          });
          const messages = (resp.result as StoredEnvelope[]) ?? [];
          if (messages.length === 0) continue;

          const ids: string[] = [];
          for (const stored of messages) {
            ids.push(stored.id);
            await onMessage({
              id: stored.id,
              conversationId,
              senderId: 'relay',
              content: stored.ciphertext,
              type: 'text',
              createdAt: new Date(stored.ts).toISOString(),
              raw: { ...stored },
            });
          }
          await this.wire.request({
            op: 'ack',
            queueId: queue.queueId,
            queueKey: queue.queueKey,
            ids,
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const timer = setInterval(() => {
      tick().catch(() => {});
    }, this.pollMs);
    tick().catch(() => {});

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async fetchHistory(): Promise<IncomingMessage[]> {
    // Un relais volatil ne conserve pas d'historique : l'historique est local.
    return [];
  }
}
