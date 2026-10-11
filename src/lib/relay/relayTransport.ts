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
import { deflate, inflate } from 'pako';

export interface RelayQueueRef {
  queueId: string;
  queueKey: string;
  /** URL du relais hebergeant cette file (reseau decentralise multi-relais). */
  relay?: string;
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

/**
 * Invitation COMPACTE : `n1.<relay>.<rcvId>.<rcvKey>.<sndId>.<sndKey>`.
 *
 * Les tokens de file sont déjà en base64url (alphabet `A-Za-z0-9-_`, sans `.`).
 * On les joint par `.` au lieu de les ré-emballer dans un JSON puis un base64 :
 * cela supprime le **double encodage** qui allongeait l'invitation (et faisait
 * déborder le QR code). Le relais (URL avec points) est base64url-encodé.
 * Rétro-compatibilité assurée pour l'ancien format base64(JSON).
 */
const INVITE_PREFIX = 'nP';

/**
 * Bornes anti-bombe de décompression pour `decodeInvite` : la longueur du lien
 * encodé ET la longueur décodée sont plafonnées. Le ratio maximal du DEFLATE
 * étant borné (~1032:1), borner l'entrée borne aussi la sortie ; on vérifie
 * néanmoins explicitement la taille décompressée (defense in depth).
 */
export const MAX_INVITE_LINK_LEN = 4096;
export const MAX_INVITE_DECODED_BYTES = 4096;

function toB64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromB64Url(value: string): Uint8Array {
  let b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encPart(value?: string): string {
  if (!value) return '';
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decPart(value: string): string | undefined {
  if (!value) return undefined;
  let b64 = value.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

/** Charge utile compacte : `<relay b64url>.<rcvId>.<rcvKey>.<sndId>.<sndKey>`. */
function invitePayload(invite: Invite): string {
  return [
    encPart(invite.rcvQueue.relay),
    invite.rcvQueue.queueId,
    invite.rcvQueue.queueKey,
    invite.sendQueue.queueId,
    invite.sendQueue.queueKey,
  ].join('.');
}

function parseInvitePayload(payload: string): Invite {
  const parts = payload.split('.');
  const relay = decPart(parts[0] ?? '');
  return {
    rcvQueue: { queueId: parts[1] ?? '', queueKey: parts[2] ?? '', relay },
    sendQueue: { queueId: parts[3] ?? '', queueKey: parts[4] ?? '', relay },
  };
}

/**
 * Invitation : charge utile compacte PUIS compression (lz-string), préfixe `nL`.
 * On supprime le double encodage JSON+base64 et on compresse → l'invitation est
 * assez courte pour tenir dans un QR code. Rétro-compatibilité ancien
 * format base64(JSON).
 */
export function encodeInvite(invite: Invite): string {
  const deflated = deflate(new TextEncoder().encode(invitePayload(invite)), { level: 9 });
  return INVITE_PREFIX + toB64Url(deflated);
}

export function decodeInvite(link: string): Invite {
  const trimmed = link.trim();
  // Anti-bombe : borne dure en entrée (voir MAX_INVITE_*).
  if (trimmed.length > MAX_INVITE_LINK_LEN) throw new Error('invitation trop longue');
  if (trimmed.startsWith(INVITE_PREFIX)) {
    let inflated: Uint8Array | null = null;
    try {
      inflated = inflate(fromB64Url(trimmed.slice(INVITE_PREFIX.length)));
    } catch {
      // format invalide → tentative legacy ci-dessous
      inflated = null;
    }
    if (inflated) {
      if (inflated.length > MAX_INVITE_DECODED_BYTES) {
        throw new Error('invitation décompressée trop volumineuse');
      }
      const payload = new TextDecoder().decode(inflated);
      if (payload.length > MAX_INVITE_DECODED_BYTES) {
        throw new Error('invitation décompressée trop volumineuse');
      }
      return parseInvitePayload(payload);
    }
  }
  // Rétro-compatibilité : ancien format base64(JSON).
  let b64 = trimmed.replaceAll('-', '+').replaceAll('_', '/');
  while (b64.length % 4) b64 += '=';
  const decoded = atob(b64);
  if (decoded.length > MAX_INVITE_DECODED_BYTES) throw new Error('invitation trop volumineuse');
  return JSON.parse(decoded) as Invite;
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
    if (!resp.ok || !resp.result) {
      // Remonte la cause (ex. repli Supabase en échec : CHECK de migration
      // manquante) au lieu d'un message générique → diagnostic exploitable.
      throw new Error(`Relay: création de file échouée${resp.error ? ` — ${resp.error}` : ''}`);
    }
    return resp.result as QueueCredentials;
  }

  /** Crée la paire de files ; renvoie la connexion locale + l'invitation à partager. */
  async createConnection(): Promise<{ connection: RelayConnection; invite: string }> {
    const inbound = await this.createQueue();  // on lit ici (rcvKey), le pair y écrit (sendKey)
    const outbound = await this.createQueue(); // le pair lit ici (rcvKey), on y écrit (sendKey)

    const connection: RelayConnection = {
      rcvQueue: { queueId: inbound.queueId, queueKey: inbound.rcvKey, relay: inbound.relay },
      sendQueue: { queueId: outbound.queueId, queueKey: outbound.sendKey, relay: outbound.relay },
    };
    const invite: Invite = {
      rcvQueue: { queueId: outbound.queueId, queueKey: outbound.rcvKey, relay: outbound.relay },
      sendQueue: { queueId: inbound.queueId, queueKey: inbound.sendKey, relay: inbound.relay },
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
      ourRcv: { queueId: queue.queueId, queueKey: queue.rcvKey, relay: queue.relay },
      peerRef: { queueId: queue.queueId, queueKey: queue.sendKey, relay: queue.relay },
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
        await this.wire.request({ op: 'delete', queueId: ref.queueId, queueKey: ref.queueKey, relay: ref.relay });
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
      relay: state.sendQueue.relay,
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
            relay: queue.relay,
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
            relay: queue.relay,
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
