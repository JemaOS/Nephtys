// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Relais à files unidirectionnelles, sans identifiants (modèle SimpleX/SMP).
 *
 * Principes :
 *   • Aucune notion d'utilisateur, de compte ni d'identité : le relais ne
 *     connaît que des **files opaques** (`queueId`) et des clés.
 *   • Chaque file est **unidirectionnelle** : une clé d'envoi (`sendKey`) pour
 *     déposer, une clé de réception (`rcvKey`) pour lire/accuser.
 *   • Une « connexion » = deux files (A→B et B→A) : le serveur ne peut donc
 *     pas relier deux interlocuteurs entre eux.
 *   • Le relais ne voit que du **ciphertext** (déjà chiffré E2EE côté client).
 *   • Stockage volatil avec TTL : le serveur n'est pas une base de données.
 *
 * Ce module est PUR (aucune E/S) → entièrement testable. Il sert de cœur au
 * serveur auto-hébergeable (`server/relay.mjs`) et au transport client.
 */

export interface QueueCredentials {
  queueId: string;
  sendKey: string;
  rcvKey: string;
}

export interface StoredEnvelope {
  id: string;
  /** Ciphertext E2EE — le relais ne l'interprète jamais. */
  ciphertext: string;
  ts: number;
  expiresAt: number;
}

const MESSAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MAX_MESSAGES_PER_QUEUE = 1000;
const DEFAULT_READ_LIMIT = 100;

function randomToken(bytes = 16): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

interface Queue {
  sendKey: string;
  rcvKey: string;
  messages: StoredEnvelope[];
}

export interface SendResult {
  id: string;
}

export class RelayCore {
  private readonly queues = new Map<string, Queue>();

  /** Crée une file et renvoie ses identifiants/clés opaques. */
  createQueue(): QueueCredentials {
    const queueId = randomToken();
    const sendKey = randomToken();
    const rcvKey = randomToken();
    this.queues.set(queueId, { sendKey, rcvKey, messages: [] });
    return { queueId, sendKey, rcvKey };
  }

  private authorize(queueId: string, key: string, kind: 'send' | 'rcv'): Queue | null {
    const queue = this.queues.get(queueId);
    if (!queue) return null;
    const expected = kind === 'send' ? queue.sendKey : queue.rcvKey;
    return expected === key ? queue : null;
  }

  private evictExpired(queue: Queue): void {
    const now = Date.now();
    if (queue.messages.length && queue.messages[0].expiresAt <= now) {
      queue.messages = queue.messages.filter(m => m.expiresAt > now);
    }
  }

  /** Dépose un message dans une file (ciphertext uniquement). */
  send(queueId: string, sendKey: string, ciphertext: string): SendResult | null {
    const queue = this.authorize(queueId, sendKey, 'send');
    if (!queue) return null;
    this.evictExpired(queue);
    if (queue.messages.length >= MAX_MESSAGES_PER_QUEUE) {
      throw new Error('RelayCore: file saturée');
    }
    const envelope: StoredEnvelope = {
      id: randomToken(9),
      ciphertext,
      ts: Date.now(),
      expiresAt: Date.now() + MESSAGE_TTL_MS,
    };
    queue.messages.push(envelope);
    return { id: envelope.id };
  }

  /** Lit les messages en attente (sans les supprimer : il faut `ack`). */
  read(queueId: string, rcvKey: string, limit = DEFAULT_READ_LIMIT): StoredEnvelope[] {
    const queue = this.authorize(queueId, rcvKey, 'rcv');
    if (!queue) return [];
    this.evictExpired(queue);
    return queue.messages.slice(0, limit);
  }

  /** Acquitte (supprime) des messages lus. Renvoie le nombre supprimé. */
  ack(queueId: string, rcvKey: string, ids: string[]): number {
    const queue = this.authorize(queueId, rcvKey, 'rcv');
    if (!queue) return 0;
    const before = queue.messages.length;
    queue.messages = queue.messages.filter(m => !ids.includes(m.id));
    return before - queue.messages.length;
  }

  /** Supprime une file (fermeture de connexion). */
  deleteQueue(queueId: string, rcvKey: string): boolean {
    const queue = this.authorize(queueId, rcvKey, 'rcv');
    if (!queue) return false;
    this.queues.delete(queueId);
    return true;
  }

  /** Nombre de files actives (diagnostic). */
  get queueCount(): number {
    return this.queues.size;
  }
}
