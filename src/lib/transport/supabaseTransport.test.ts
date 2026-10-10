// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let captured: Record<string, unknown> | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      insert: (payload: Record<string, unknown>) => {
        captured = payload;
        return {
          select: () => ({ single: async () => ({ data: { id: 'm1' }, error: null }) }),
        };
      },
    }),
  },
}));

import { SupabaseTransport } from './supabaseTransport';

describe('SupabaseTransport — parité de champs (phases 1/2)', () => {
  beforeEach(() => {
    captured = null;
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
    expect(captured).not.toBeNull();
    expect(captured?.sender_sealed).toEqual(['blob-a', 'blob-b']);
    expect(captured?.link_preview).toEqual({ url: 'https://exemple' });
    expect(captured?.media_thumbnail).toBe('thumb');
    expect(captured?.media_width).toBe(10);
    expect(captured?.file_url).toBe('bucket/f.pdf');
    expect(captured?.is_text_encrypted).toBe(true);
  });

  it('omet les champs non fournis', async () => {
    const t = new SupabaseTransport();
    await t.sendMessage({ conversationId: 'c1', senderId: 'u1', content: 'x', type: 'text' });
    expect(captured).not.toBeNull();
    expect('sender_sealed' in (captured ?? {})).toBe(false);
    expect('link_preview' in (captured ?? {})).toBe(false);
  });
});
