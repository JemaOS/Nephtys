// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { AgentRelayWire } from './agentRelayWire';

class MockWebSocket {
  static last: MockWebSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = 0;
  sent: string[] = [];
  constructor(public url: string) {
    MockWebSocket.last = this;
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
}

async function nextSent(ws: MockWebSocket): Promise<any> {
  for (let i = 0; i < 200 && ws.sent.length === 0; i++) await new Promise(r => setTimeout(r, 1));
  return JSON.parse(ws.sent.shift()!);
}

function reply(ws: MockWebSocket, corrId: string, resp: unknown): void {
  ws.onmessage?.({ data: JSON.stringify({ corrId, resp }) });
}

describe('AgentRelayWire — mode privé via agent SimpleX', () => {
  it('createQueue → référence de chat ; send → /_send ; réception → read', async () => {
    const wire = new AgentRelayWire('ws://x', {
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
    });
    const ws = () => MockWebSocket.last!;

    // createQueue
    const pCreate = wire.request({ op: 'createQueue' });
    const c1 = await nextSent(ws());
    reply(ws(), c1.corrId, { type: 'direct', contact: { contactId: 5 } });
    const rCreate = await pCreate;
    expect(rCreate.ok).toBe(true);
    expect((rCreate.result as { queueId: string }).queueId).toBe('@5');

    // send → commande /_send avec le ciphertext
    const pSend = wire.request({ op: 'send', queueId: '@5', queueKey: 'agent', ciphertext: 'CIBPHER' });
    const c2 = await nextSent(ws());
    expect(c2.cmd).toContain('/_send @5 json');
    expect(c2.cmd).toContain('CIBPHER');
    reply(ws(), c2.corrId, { type: 'newChatItems', chatItems: [{ chatItem: { meta: { itemId: 42 } } }] });
    const rSend = await pSend;
    expect(rSend.ok).toBe(true);
    expect((rSend.result as { id: string }).id).toBe('42');

    // événement entrant → bufferisé puis lu une seule fois
    ws().onmessage?.({
      data: JSON.stringify({
        resp: {
          type: 'newChatItem',
          chatItem: {
            chatInfo: { type: 'direct', contact: { contactId: 5 } },
            chatItem: { content: { msgContent: { text: 'ENTRANT' } }, meta: { itemId: 1 } },
          },
        },
      }),
    });

    const rRead = await wire.request({ op: 'read', queueId: '@5', queueKey: 'agent' });
    const list = rRead.result as Array<{ ciphertext: string }>;
    expect(list).toHaveLength(1);
    expect(list[0].ciphertext).toBe('ENTRANT');

    const rRead2 = await wire.request({ op: 'read', queueId: '@5', queueKey: 'agent' });
    expect(rRead2.result as unknown[]).toHaveLength(0);
  });

  it('ack/delete ne lèvent pas', async () => {
    const wire = new AgentRelayWire('ws://x', {
      WebSocketCtor: MockWebSocket as unknown as typeof WebSocket,
    });
    const rAck = await wire.request({ op: 'ack', queueId: '@5', queueKey: 'agent', ids: ['1'] });
    expect(rAck.ok).toBe(true);
  });
});
