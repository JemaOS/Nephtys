// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Encapsulation du relais : opérations du protocole + deux implémentations
 * de « wire » (transport bas niveau) :
 *   • LocalWire         : appelle directement `RelayCore` (tests, usage local) ;
 *   • WebSocketWire     : parle à un serveur relais auto-hébergé via WebSocket.
 *
 * Le protocole est volontairement minimal et sans identifiants — seuls des
 * `queueId` opaques et des clés circulent.
 */

import { RelayCore, type QueueCredentials, type StoredEnvelope } from './relayCore';

export type RelayOp =
  | { op: 'createQueue' }
  | { op: 'send'; queueId: string; queueKey: string; ciphertext: string }
  | { op: 'read'; queueId: string; queueKey: string; limit?: number }
  | { op: 'ack'; queueId: string; queueKey: string; ids: string[] }
  | { op: 'delete'; queueId: string; queueKey: string };

export interface RelayResponse {
  ok: boolean;
  error?: string;
  result?: QueueCredentials | StoredEnvelope[] | { id: string } | number | boolean;
}

export interface RelayWire {
  request(op: RelayOp): Promise<RelayResponse>;
}

/** Wire en mémoire (tests) — exécute directement le cœur du relais. */
export class LocalWire implements RelayWire {
  constructor(private readonly core: RelayCore) {}

  async request(op: RelayOp): Promise<RelayResponse> {
    switch (op.op) {
      case 'createQueue':
        return { ok: true, result: this.core.createQueue() };
      case 'send': {
        const result = this.core.send(op.queueId, op.queueKey, op.ciphertext);
        return result ? { ok: true, result } : { ok: false, error: 'unauthorized' };
      }
      case 'read':
        return { ok: true, result: this.core.read(op.queueId, op.queueKey, op.limit) };
      case 'ack':
        return { ok: true, result: this.core.ack(op.queueId, op.queueKey, op.ids) };
      case 'delete':
        return { ok: true, result: this.core.deleteQueue(op.queueId, op.queueKey) };
    }
  }
}

/** Wire WebSocket vers un serveur relais auto-hébergé. */
export class WebSocketWire implements RelayWire {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private correlation = 0;
  private readonly pending = new Map<string, (resp: RelayResponse) => void>();

  constructor(private readonly url: string, private readonly timeoutMs = 10_000) {}

  private async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === 1) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url);
      ws.onopen = () => {
        this.socket = ws;
        resolve();
      };
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(String(ev.data));
          const resolver = this.pending.get(msg.id);
          if (resolver) {
            this.pending.delete(msg.id);
            resolver(msg.response as RelayResponse);
          }
        } catch {
          // ignore les trames illisibles
        }
      };
      ws.onerror = () => reject(new Error('RelayWire: erreur WebSocket'));
      ws.onclose = () => {
        this.socket = null;
      };
    });
    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    await this.ensureConnected();
    const id = `${++this.correlation}`;
    return new Promise<RelayResponse>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout' });
      }, this.timeoutMs);
      this.pending.set(id, resp => {
        clearTimeout(timer);
        resolve(resp);
      });
      this.socket!.send(JSON.stringify({ id, op }));
    });
  }
}
