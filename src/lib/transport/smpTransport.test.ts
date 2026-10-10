import { describe, it, expect, beforeEach } from 'vitest';
import { SmpTransport } from './smpTransport';

/** Fausse WebSocket : capture les trames envoyées et permet d'injecter des réponses. */
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  onopen: ((e?: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e?: unknown) => void) | null = null;
  onclose: ((e?: unknown) => void) | null = null;
  readyState = 0;
  sent: string[] = [];

  constructor(public url: string) {
    FakeWebSocket.last = this;
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  receive(obj: unknown): void {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

const tick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms));

function makeTransport() {
  return new SmpTransport('ws://127.0.0.1:5225', {
    WebSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
    timeoutMs: 1000,
  });
}

describe('SmpTransport', () => {
  beforeEach(() => {
    FakeWebSocket.last = null;
  });

  it('sends a /_send command in the SimpleX grammar and correlates the response', async () => {
    const transport = makeTransport();
    const pending = transport.sendMessage({
      conversationId: '@12',
      senderId: 'me',
      content: 'bonjour',
      type: 'text',
    });

    await tick();
    const ws = FakeWebSocket.last!;
    expect(ws.sent).toHaveLength(1);
    const frame = JSON.parse(ws.sent[0]);
    expect(frame.cmd).toBe(
      '/_send @12 json [{"msgContent":{"type":"text","text":"bonjour"},"mentions":{}}]',
    );

    ws.receive({ corrId: frame.corrId, resp: { type: 'newChatItems', chatItems: [{ chatItem: { meta: { itemId: 42 } } }] } });
    const result = await pending;
    expect(result.id).toBe('42');
  });

  it('rejects when the agent returns a chatCmdError', async () => {
    const transport = makeTransport();
    const pending = transport.sendMessage({
      conversationId: '#3',
      senderId: 'me',
      content: 'x',
      type: 'text',
    });

    await tick();
    const ws = FakeWebSocket.last!;
    const frame = JSON.parse(ws.sent[0]);
    ws.receive({ corrId: frame.corrId, resp: { type: 'chatCmdError', chatError: { type: 'error' } } });

    await expect(pending).rejects.toThrow(/erreur d’envoi/);
  });

  it('delivers new chat items to subscribers, filtered by conversation', async () => {
    const transport = makeTransport();
    const received: any[] = [];
    const unsubscribe = transport.subscribe('@5', m => received.push(m));

    await tick();
    const ws = FakeWebSocket.last!;

    // Mauvais contact → ignoré
    ws.receive({
      resp: {
        type: 'newChatItem',
        chatItem: {
          chatInfo: { type: 'direct', contact: { contactId: 6 } },
          chatItem: {
            meta: { itemId: 1, itemTs: 1700000000000 },
            content: { type: 'text', msgContent: { type: 'text', text: 'ignore' } },
          },
        },
      },
    });

    // Bon contact → livré
    ws.receive({
      resp: {
        type: 'newChatItem',
        chatItem: {
          chatInfo: { type: 'direct', contact: { contactId: 5 } },
          chatItem: {
            meta: { itemId: 7, itemTs: 1700000000000 },
            content: { type: 'text', msgContent: { type: 'text', text: 'salut' } },
          },
        },
      },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ id: '7', conversationId: '@5', content: 'salut' });

    unsubscribe();
  });

  it('has no server-side history (SMP by design)', async () => {
    const transport = makeTransport();
    await expect(transport.fetchHistory('@1')).resolves.toEqual([]);
  });
});
