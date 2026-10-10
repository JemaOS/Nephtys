// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * RelayWire piloté par un **agent SimpleX** (`simplex-chat`).
 *
 * But : permettre au **mode privé** d'utiliser l'infrastructure SimpleX (l'agent
 * porte les messages aux relais **SMP publics**) au lieu du protocole maison.
 *
 * L'agent expose une API WebSocket (défaut `ws://127.0.0.1:5225`) :
 *   • requête  `{ corrId, cmd }` → réponse `{ corrId, resp }` ;
 *   • événements `{ resp: <ChatEvent> }` (sans corrId).
 *
 * ⚠️ HONNÊTETÉ / hypothèses (non vérifiables sans agent réel) :
 *   • la commande de **création de connexion** est paramétrable (`createCmd`,
 *     défaut `/_connect`) car la grammaire exacte dépend de la version de l'agent ;
 *   • l'envoi réutilise la grammaire documentée `/_send <@id> json [...]` ;
 *   • SMP n'a **pas d'historique serveur** → seul le flux d'événements est lu.
 * À VALIDER avec un agent en écoute ; marqué **expérimental**.
 *
 * @module agentRelayWire
 */

import type { RelayOp, RelayResponse, RelayWire } from './wire';
import type { QueueCredentials, StoredEnvelope } from './relayCore';

export interface AgentRelayOptions {
  /** Constructeur WebSocket (injectable pour les tests). */
  WebSocketCtor?: typeof WebSocket;
  timeoutMs?: number;
  /** Commande de création de connexion (agent). Défaut `/_connect`. */
  createCmd?: string;
}

interface PendingRequest {
  resolve: (resp: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Référence de chat SimpleX : `@<contactId>` ou `#<groupId>`. */
function chatRefOf(info: any): string | null {
  if (!info) return null;
  if (info.type === 'direct' && info.contact) return `@${info.contact.contactId}`;
  if (info.type === 'group' && info.groupInfo) return `#${info.groupInfo.groupId}`;
  return null;
}

export class AgentRelayWire implements RelayWire {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private correlation = 0;
  private readonly pending = new Map<string, PendingRequest>();
  /** Événements entrants en attente de lecture, par référence de chat. */
  private readonly inbox = new Map<string, StoredEnvelope[]>();
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly timeoutMs: number;
  private readonly createCmd: string;

  constructor(private readonly url = 'ws://127.0.0.1:5225', options: AgentRelayOptions = {}) {
    const Ws = options.WebSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Ws) throw new Error('AgentRelayWire: aucune implémentation WebSocket disponible');
    this.WebSocketCtor = Ws;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.createCmd = options.createCmd ?? '/_connect';
  }

  private isOpen(): boolean {
    return !!this.socket && this.socket.readyState === 1;
  }

  private async ensureConnected(): Promise<void> {
    if (this.isOpen()) return;
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const ws = new this.WebSocketCtor(this.url);
      ws.onopen = () => {
        this.socket = ws;
        resolve();
      };
      ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
      ws.onerror = () => reject(new Error('AgentRelayWire: erreur WebSocket'));
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

  private handleMessage(data: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data));
    } catch {
      return;
    }
    if (msg && typeof msg.corrId === 'string') {
      const p = this.pending.get(msg.corrId);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(msg.corrId);
        p.resolve(msg.resp);
      }
      return;
    }
    if (msg && 'resp' in msg) this.handleEvent(msg.resp);
  }

  /** Bufferise les messages entrants (`newChatItem`) par chat. */
  private handleEvent(resp: any): void {
    if (resp?.type !== 'newChatItem') return;
    const info = resp.chatItem?.chatInfo;
    const chatItem = resp.chatItem?.chatItem;
    const text = chatItem?.content?.msgContent?.text;
    if (typeof text !== 'string') return;
    const ref = chatRefOf(info);
    if (!ref) return;
    const list = this.inbox.get(ref) ?? [];
    const ts = chatItem?.meta?.itemTs ? new Date(chatItem.meta.itemTs).getTime() : Date.now();
    list.push({
      id: String(chatItem?.meta?.itemId ?? chatItem?.chatItemId ?? crypto.randomUUID()),
      ciphertext: text,
      ts,
      expiresAt: ts + 7 * 24 * 60 * 60 * 1000,
    });
    this.inbox.set(ref, list);
  }

  private async cmd(command: string): Promise<any> {
    await this.ensureConnected();
    const corrId = `${++this.correlation}`;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(corrId);
        reject(new Error('AgentRelayWire: délai d’attente dépassé'));
      }, this.timeoutMs);
      this.pending.set(corrId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ corrId, cmd: command }));
    });
  }

  async request(op: RelayOp): Promise<RelayResponse> {
    try {
      switch (op.op) {
        case 'createQueue': {
          // Crée une connexion côté agent → on renvoie sa référence comme queueId.
          const resp = await this.cmd(this.createCmd);
          const ref = chatRefOf(resp?.chatInfo ?? resp) ?? (resp?.contactId != null ? `@${resp.contactId}` : null);
          if (!ref) return { ok: false, error: `agent: pas de connexion créée (${JSON.stringify(resp?.type ?? resp)})` };
          const creds: QueueCredentials = { queueId: ref, sendKey: 'agent', rcvKey: 'agent' };
          return { ok: true, result: creds };
        }
        case 'send': {
          const composed = [{ msgContent: { type: 'text', text: op.ciphertext }, mentions: {} }];
          const resp = await this.cmd(`/_send ${op.queueId} json ${JSON.stringify(composed)}`);
          if (resp?.type === 'chatCmdError') return { ok: false, error: JSON.stringify(resp.chatError) };
          const item = resp?.chatItems?.[0]?.chatItem ?? resp?.chatItems?.[0] ?? resp?.chatItem;
          return { ok: true, result: { id: String(item?.meta?.itemId ?? item?.chatItemId ?? '-1') } };
        }
        case 'read': {
          const list = this.inbox.get(op.queueId) ?? [];
          this.inbox.set(op.queueId, []);
          return { ok: true, result: list };
        }
        case 'ack':
          // L'agent acquitte lui-même côté SMP.
          return { ok: true, result: true };
        case 'delete': {
          await this.cmd(`/_delete ${op.queueId}`).catch(() => undefined);
          return { ok: true, result: true };
        }
      }
    } catch (e) {
      return { ok: false, error: (e as Error)?.message ?? 'agent error' };
    }
  }

  /** Ferme la connexion à l'agent. */
  close(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('AgentRelayWire: fermé'));
    }
    this.pending.clear();
    this.socket?.close();
    this.socket = null;
  }
}
