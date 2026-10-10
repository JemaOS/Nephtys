// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Transport SMP (SimpleX Messaging Protocol) — client WebSocket vers un
 * agent SimpleX local.
 *
 * Ce module implémente le **plomberie de transport** réellement utilisée par
 * le client SimpleX officiel (cf. `simplex-chat/packages/simplex-chat-client/
 * typescript/src/transport.ts`) :
 *
 *   • liaison WebSocket vers l'agent (défaut `ws://127.0.0.1:5225`) ;
 *   • trames JSON : requête `{ corrId, cmd }` → réponse `{ corrId, resp }` ;
 *     événements serveur `{ resp: <ChatEvent> }` (sans corrId) ;
 *   • corrélation des réponses par `corrId` + distribution des événements.
 *
 * Le niveau « commande » réutilise la grammaire documentée de SimpleX :
 *   `/_send <@id|#id> json [<composedMessage>]`
 * avec `composedMessage = { msgContent: { type: "text", text }, mentions: {} }`.
 *
 * Ce que ce transport N'EST PAS (honnêtement) :
 *   • il ne gère pas encore le mapping conversation Nephtys ↔ chat SimpleX
 *     (l'adresse de conversation est passée telle quelle, p.ex. `@12`) ;
 *   • il ne persiste pas d'historique : SMP n'a pas d'historique côté
 *     serveur par conception → `fetchHistory` renvoie `[]` (le client doit
 *     s'appuyer sur sa base locale).
 *
 * Prérequis : un agent `simplex-chat` en écoute (voir docs/CLI.md et
 * docs/CHAT-RELAY.md). Tant que `SmpTransport` n'est pas branché comme
 * transport par défaut, l'app continue d'utiliser `SupabaseTransport`.
 */

import type {
  IncomingMessage,
  MessagingTransport,
  OutgoingMessage,
  SendResult,
  Unsubscribe,
} from './types';

export interface SmpTransportOptions {
  /** Constructeur WebSocket (injectable pour les tests). Défaut : global. */
  WebSocketCtor?: typeof WebSocket;
  /** Délai max d'attente d'une réponse d'API à une commande (ms). */
  timeoutMs?: number;
}

interface PendingRequest {
  resolve: (resp: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** @see ChatRef.cmdString de SimpleX : `@<contactId>` (direct) ou `#<groupId>`. */
function chatRefOf(info: any): string | null {
  if (!info) return null;
  if (info.type === 'direct' && info.contact) return `@${info.contact.contactId}`;
  if (info.type === 'group' && info.groupInfo) return `#${info.groupInfo.groupId}`;
  return null;
}

function peerIdOf(info: any): string {
  return String(info?.contact?.contactId ?? info?.groupInfo?.groupId ?? 'unknown');
}

export class SmpTransport implements MessagingTransport {
  readonly kind = 'smp';

  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private correlation = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(event: any) => void>();
  private readonly WebSocketCtor: typeof WebSocket;
  private readonly timeoutMs: number;

  constructor(private readonly url: string, options: SmpTransportOptions = {}) {
    const Ws = options.WebSocketCtor ?? (globalThis as any).WebSocket;
    if (!Ws) throw new Error('SmpTransport: aucune implémentation WebSocket disponible');
    this.WebSocketCtor = Ws;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  // ─── Connexion ──────────────────────────────────────────────────────

  private isOpen(): boolean {
    return !!this.socket && this.socket.readyState === 1; // OPEN
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
      ws.onerror = () => reject(new Error('SmpTransport: erreur de connexion WebSocket'));
      ws.onclose = () => {
        this.socket = null;
        this.failAll('SmpTransport: connexion fermée');
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
      const pending = this.pending.get(msg.corrId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.corrId);
        pending.resolve(msg.resp);
      }
      return;
    }
    if (msg && 'resp' in msg) {
      for (const listener of this.listeners) {
        try {
          listener(msg.resp);
        } catch {
          // un listener défaillant ne doit pas casser la boucle
        }
      }
    }
  }

  private failAll(reason: string): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  // ─── Bas niveau : une commande API corrélée ────────────────────────

  async request(cmd: string): Promise<any> {
    await this.ensureConnected();
    const corrId = `${++this.correlation}`;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(corrId);
        reject(new Error('SmpTransport: délai d’attente dépassé'));
      }, this.timeoutMs);
      this.pending.set(corrId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ corrId, cmd }));
    });
  }

  // ─── MessagingTransport ────────────────────────────────────────────

  async sendMessage(msg: OutgoingMessage): Promise<SendResult> {
    // `conversationId` porte l'adresse SimpleX (`@<contactId>` ou `#<groupId>`).
    const composed = [{ msgContent: { type: 'text', text: msg.content }, mentions: {} }];
    const cmd = `/_send ${msg.conversationId} json ${JSON.stringify(composed)}`;
    const resp = await this.request(cmd);

    if (resp?.type === 'newChatItems') {
      const item = resp.chatItems?.[0]?.chatItem ?? resp.chatItems?.[0];
      const id = item?.meta?.itemId ?? item?.chatItemId;
      return { id: id != null ? String(id) : '-1', raw: resp };
    }
    if (resp?.type === 'chatCmdError') {
      throw new Error(`SmpTransport: erreur d’envoi — ${JSON.stringify(resp.chatError)}`);
    }
    return { id: '-1', raw: resp };
  }

  subscribe(conversationId: string, onMessage: (msg: IncomingMessage) => void): Unsubscribe {
    const listener = (resp: any) => {
      if (resp?.type !== 'newChatItem') return;
      const info = resp.chatItem?.chatInfo;
      const chatItem = resp.chatItem?.chatItem;
      const text = chatItem?.content?.msgContent?.text;
      if (typeof text !== 'string') return;

      const conv = chatRefOf(info);
      if (conversationId && conv && conv !== conversationId) return;

      onMessage({
        id: String(chatItem?.meta?.itemId ?? chatItem?.chatItemId ?? ''),
        conversationId: conv ?? conversationId,
        senderId: peerIdOf(info),
        content: text,
        type: 'text',
        createdAt: chatItem?.meta?.itemTs
          ? new Date(chatItem.meta.itemTs).toISOString()
          : new Date().toISOString(),
        raw: resp,
      });
    };

    this.listeners.add(listener);
    // Ouvre la connexion pour recevoir les événements.
    this.ensureConnected().catch(() => {});
    return () => {
      this.listeners.delete(listener);
    };
  }

  async fetchHistory(_conversationId: string, _limit?: number): Promise<IncomingMessage[]> {
    // SMP ne conserve pas de messages côté serveur : l'historique est local.
    return [];
  }

  async close(): Promise<void> {
    this.failAll('SmpTransport: fermé');
    this.socket?.close();
    this.socket = null;
  }
}
