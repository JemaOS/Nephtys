// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = {
    captured: null as Record<string, unknown> | null,
    handlers: {} as Record<string, (p: { new?: unknown; old?: unknown }) => void>,
  };
  const channelObj = {
    on: (_evt: string, opts: { event: string }, cb: (p: { new?: unknown; old?: unknown }) => void) => {
      state.handlers[opts.event] = cb;
      return channelObj;
    },
    subscribe: () => channelObj,
  };
  return { state, channelObj };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        h.state.captured = payload;
        return { select: () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }) };
      },
    }),
    channel: () => h.channelObj,
    removeChannel: () => {},
  },
}));

import { SupabaseTransport } from './supabaseTransport';

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'a', conversation_id: 'c1', sender_id: 'u', content: 'x', type: 'text', created_at: '', ...over };
}

describe('SupabaseTransport — parité de champs (phases 1/2)', () => {
  beforeEach(() => {
    h.state.captured = null;
    h.state.handlers = {};
  });

  it('transporte le sealed sender + champs média/aperçu (drop-in réel)', async () => {
    const t = new SupabaseTransport();
    const res = await t.sendMessage({
      conversationId: 'c1',
      senderId: 'u1',
      content: 'ciphertext',
      type: 'text',
      isTextEncrypted: true,
      encryptionMetadata: { v: 1, iv: 'x' },
      senderSealed: ['blob-a', 'blob-b'],
      linkPreview: { url: 'https://exemple' },
      mediaThumbnail: 'thumb',
      mediaWidth: 10,
      mediaHeight: 20,
      fileUrl: 'bucket/f.pdf',
      fileName: 'f.pdf',
      fileSize: 123,
    });

    expect(res.id).toBe('m1');
    expect(h.state.captured?.sender_sealed).toEqual(['blob-a', 'blob-b']);
    expect(h.state.captured?.link_preview).toEqual({ url: 'https://exemple' });
    expect(h.state.captured?.media_thumbnail).toBe('thumb');
    expect(h.state.captured?.file_url).toBe('bucket/f.pdf');
    expect(h.state.captured?.is_text_encrypted).toBe(true);
  });

  it('omet les champs non fournis', async () => {
    const t = new SupabaseTransport();
    await t.sendMessage({ conversationId: 'c1', senderId: 'u1', content: 'x', type: 'text' });
    expect('sender_sealed' in (h.state.captured ?? {})).toBe(false);
    expect('link_preview' in (h.state.captured ?? {})).toBe(false);
  });
});

describe('SupabaseTransport — subscribeEvents (réception temps réel)', () => {
  beforeEach(() => {
    h.state.captured = null;
    h.state.handlers = {};
  });

  it('délivre insert / update / delete', () => {
    const t = new SupabaseTransport();
    const kinds: string[] = [];
    const unsub = t.subscribeEvents('c1', ev => kinds.push(ev.kind));

    h.state.handlers.INSERT?.({ new: row({ content: 'neuf' }) });
    h.state.handlers.UPDATE?.({ new: row({ content: 'édité' }) });
    h.state.handlers.DELETE?.({ old: row({ content: '' }) });

    expect(kinds).toEqual(['insert', 'update', 'delete']);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});
