// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Sealed sender — média : un message média SANS `sender_public_key` stocké
 * (nouveau trafic) doit rester déchiffrable : la clé publique X25519 de
 * l'expéditeur est retrouvée via le payload sealed sender v3 (ou `profiles`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateX25519KeyPair, wrapKeyForRecipientX25519, keyWrapAad } from './x25519';
import { generateSigningKeyPair } from './ratchet/x3dh';
import { sealSenderForRecipient, sealedContentHash } from './messaging/sealedSender';

const h = vi.hoisted(() => ({
  signingKeys: {} as Record<string, string>,
  x25519Keys: {} as Record<string, string>,
  members: {} as Record<string, string[]>,
  mediaKeyRow: null as any,
  messageRow: null as any,
  recipient: null as { publicKey: string; privateKey: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const from = (table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({
              data: {
                x25519_public_key: h.x25519Keys[id] ?? null,
                ratchet_signing_key: h.signingKeys[id] ?? null,
              },
            }),
          }),
        }),
      };
    }
    if (table === 'messages') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: h.messageRow }) }),
        }),
      };
    }
    if (table === 'conversation_members') {
      return {
        select: () => ({
          eq: (_col: string, conversationId: string) => ({
            then: (resolve: (v: unknown) => unknown) =>
              resolve({
                data: (h.members[conversationId] ?? []).map(uid => ({ user_id: uid })),
                error: null,
              }),
          }),
        }),
      };
    }
    // message_media_keys : `.select().eq().eq().maybeSingle()`
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: h.mediaKeyRow, error: null }),
    };
    return chain;
  };
  return { supabase: { from } };
});

vi.mock('@/lib/e2eeX25519', () => ({
  getLocalX25519KeyPair: async () => h.recipient,
  fetchX25519PublicKeys: async (ids: string[]) => {
    const map = new Map<string, string>();
    for (const id of ids) {
      const key = h.x25519Keys[id];
      if (key) map.set(id, key);
    }
    return map;
  },
}));

vi.mock('@/lib/offlineStorage', () => ({
  offlineStorage: {
    getMediaBlob: async () => null,
    saveMediaBlob: async () => {},
  },
}));

import { fetchMediaRawKey } from './encryptedMediaService';

function randomKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

describe('encryptedMediaService — clé d\'expéditeur SANS colonne (sealed sender)', () => {
  beforeEach(() => {
    h.x25519Keys = {};
    h.signingKeys = {};
    h.members = {};
    h.mediaKeyRow = null;
    h.messageRow = null;
  });

  it('déchiffre la clé média SANS sender_public_key stocké (clé via payload v3)', async () => {
    const alice = generateX25519KeyPair();   // expéditeur
    const bob = generateX25519KeyPair();     // destinataire
    const aliceSign = generateSigningKeyPair();
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };
    h.signingKeys['alice-id'] = aliceSign.publicKey;

    const rawKey = randomKey();
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );
    const mediaIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));

    const context = {
      conversationId: 'conv',
      messageId: 'm-media',
      contentHash: await sealedContentHash(''),
    };
    const blob = await sealSenderForRecipient(bob.publicKey, 'alice-id', aliceSign.privateKey, context, {
      x25519Key: alice.publicKey,
    });

    h.mediaKeyRow = {
      encrypted_key: wrapped.encryptedKey,
      iv: wrapped.iv,
      sender_public_key: null,
      media_iv: mediaIv,
    };
    h.messageRow = {
      id: 'm-media',
      conversation_id: 'conv',
      content: '',
      sender_id: 'alice-id',
      sender_sealed: [blob],
    };

    const out = await fetchMediaRawKey('m-media', 'bob-id');
    expect(out).not.toBeNull();
    expect(Array.from(out!.rawKey)).toEqual(Array.from(rawKey));
    expect(out!.mediaIvBase64).toBe(mediaIv);
  });

  it('déchiffre un ANCIEN média AVEC sender_public_key (rétrocompat)', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };

    const rawKey = randomKey();
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );
    const mediaIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));

    h.mediaKeyRow = {
      encrypted_key: wrapped.encryptedKey,
      iv: wrapped.iv,
      sender_public_key: alice.publicKey,
      media_iv: mediaIv,
    };

    const out = await fetchMediaRawKey('m-legacy-media', 'bob-id');
    expect(out).not.toBeNull();
    expect(Array.from(out!.rawKey)).toEqual(Array.from(rawKey));
  });

  it('déchiffre via la clé d\'un membre quand colonne et v3 sont absents (repli)', async () => {
    const alice = generateX25519KeyPair();   // expéditeur (membre)
    const bob = generateX25519KeyPair();     // destinataire / lecteur
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };
    h.members = { conv: ['alice-id', 'bob-id'] };
    h.x25519Keys = { 'alice-id': alice.publicKey };

    const rawKey = randomKey();
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );
    const mediaIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));

    h.mediaKeyRow = {
      encrypted_key: wrapped.encryptedKey,
      iv: wrapped.iv,
      sender_public_key: null,
      media_iv: mediaIv,
    };
    h.messageRow = {
      id: 'm-cand',
      conversation_id: 'conv',
      content: '',
      sender_id: null,
      sender_sealed: null,
    };

    const out = await fetchMediaRawKey('m-cand', 'bob-id');
    expect(out).not.toBeNull();
    expect(Array.from(out!.rawKey)).toEqual(Array.from(rawKey));
    expect(out!.mediaIvBase64).toBe(mediaIv);
  });
});
