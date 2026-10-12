// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateX25519KeyPair, wrapKeyForRecipientX25519, keyWrapAad } from './x25519';
import { generateSigningKeyPair } from './ratchet/x3dh';
import { sealSenderForRecipient, sealedContentHash } from './messaging/sealedSender';

const h = vi.hoisted(() => ({
  signingKeys: {} as Record<string, string>,
  x25519Keys: {} as Record<string, string>,
  members: {} as Record<string, string[]>,
  textKeyRows: [] as any[],
  recipient: null as { publicKey: string; privateKey: string } | null,
}));

vi.mock('@/lib/supabase', () => {
  const profileRow = (id: string) => ({
    ratchet_signing_key: h.signingKeys[id] ?? null,
    x25519_public_key: h.x25519Keys[id] ?? null,
  });
  const from = (table: string) => {
    if (table === 'profiles') {
      return {
        select: () => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: async () => ({ data: profileRow(id) }),
          }),
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
    // message_text_keys : batch `.in(...)` (thenable) ET single `.eq().eq().maybeSingle()`.
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      maybeSingle: async () => ({ data: h.textKeyRows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: h.textKeyRows, error: null }),
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

import { resolveSealedSenders, decryptMessageRows, encryptText } from './textEncryption';

describe('resolveSealedSenders — serveur aveugle à l\'expéditeur (Phase 1c)', () => {
  it('résout sender_id NULL via les blobs sealed', async () => {
    const alice = generateX25519KeyPair();      // destinataire (lecteur)
    const bobSign = generateSigningKeyPair();    // expéditeur B
    const bobId = 'bob-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[bobId] = bobSign.publicKey;

    const blob = await sealSenderForRecipient(alice.publicKey, bobId, bobSign.privateKey);
    const rows: Array<{ sender_id: string | null; sender_sealed?: unknown }> = [
      { sender_id: null, sender_sealed: [blob] },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBe(bobId);
  });

  it('rejette un scellé usurpé (sender_id reste NULL)', async () => {
    const alice = generateX25519KeyPair();
    const victimSign = generateSigningKeyPair();
    const attackerSign = generateSigningKeyPair();
    const victimId = 'victim-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[victimId] = victimSign.publicKey; // clé publiée de la victime

    // L'attaquant scelle « victim » mais signe avec SA clé → vérif échoue.
    const forged = await sealSenderForRecipient(alice.publicKey, victimId, attackerSign.privateKey);
    const rows: Array<{ sender_id: string | null; sender_sealed?: unknown }> = [
      { sender_id: null, sender_sealed: [forged] },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBeNull();
  });
});

describe('resolveSealedSenders — sealed sender v3 (anti-rejeu)', () => {
  it('résout un blob v3 dont le contexte correspond à la ligne', async () => {
    const alice = generateX25519KeyPair();
    const bobSign = generateSigningKeyPair();
    const bobId = 'bob-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[bobId] = bobSign.publicKey;

    const content = 'CIPHERTEXT_B64';
    const context = {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash(content),
    };
    const blob = await sealSenderForRecipient(alice.publicKey, bobId, bobSign.privateKey, context);
    const rows: Array<{
      id: string;
      conversation_id: string;
      content: string;
      sender_id: string | null;
      sender_sealed?: unknown;
    }> = [
      { id: 'msg-1', conversation_id: 'conv-1', content, sender_id: null, sender_sealed: [blob] },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBe(bobId);
  });

  it('REJETTE un blob v3 recopié sur un autre message (sender_id reste NULL)', async () => {
    const alice = generateX25519KeyPair();
    const bobSign = generateSigningKeyPair();
    const bobId = 'bob-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[bobId] = bobSign.publicKey;

    const context = {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash('ORIGINAL'),
    };
    const blob = await sealSenderForRecipient(alice.publicKey, bobId, bobSign.privateKey, context);
    // Le blob d'origine est copié sur une AUTRE ligne (id + contenu différents).
    const rows: Array<{
      id: string;
      conversation_id: string;
      content: string;
      sender_id: string | null;
      sender_sealed?: unknown;
    }> = [
      { id: 'msg-2', conversation_id: 'conv-1', content: 'AUTRE', sender_id: null, sender_sealed: [blob] },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBeNull();
  });
});

describe('resolveSealedSenders — bascule v2 → v3 (V2_SUNSET_ISO)', () => {
  it('REJETTE un blob v2 sur un message POSTÉRIEUR à la bascule (sender non attribué)', async () => {
    const alice = generateX25519KeyPair();
    const bobSign = generateSigningKeyPair();
    const bobId = 'bob-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[bobId] = bobSign.publicKey;

    // Scellé v2 (sans contexte) : rejouable.
    const blobV2 = await sealSenderForRecipient(alice.publicKey, bobId, bobSign.privateKey);
    const rows: Array<{
      id: string;
      conversation_id: string;
      content: string;
      created_at: string;
      sender_id: string | null;
      sender_sealed?: unknown;
    }> = [
      {
        id: 'msg-new',
        conversation_id: 'conv-1',
        content: 'CIPHER',
        created_at: '2026-11-02T00:00:00Z',
        sender_id: null,
        sender_sealed: [blobV2],
      },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBeNull();
  });

  it('accepte un blob v2 sur un message ANTÉRIEUR à la bascule (rétrocompat historique)', async () => {
    const alice = generateX25519KeyPair();
    const bobSign = generateSigningKeyPair();
    const bobId = 'bob-id';
    h.recipient = { publicKey: alice.publicKey, privateKey: alice.privateKey };
    h.signingKeys[bobId] = bobSign.publicKey;

    const blobV2 = await sealSenderForRecipient(alice.publicKey, bobId, bobSign.privateKey);
    const rows: Array<{
      id: string;
      conversation_id: string;
      content: string;
      created_at: string;
      sender_id: string | null;
      sender_sealed?: unknown;
    }> = [
      {
        id: 'msg-old',
        conversation_id: 'conv-1',
        content: 'CIPHER',
        created_at: '2026-10-30T00:00:00Z',
        sender_id: null,
        sender_sealed: [blobV2],
      },
    ];

    await resolveSealedSenders(rows, 'alice-id');
    expect(rows[0].sender_id).toBe(bobId);
  });
});

describe('textEncryption — clé d\'expéditeur SANS colonne (sealed sender)', () => {
  beforeEach(() => {
    h.x25519Keys = {};
    h.members = {};
    h.textKeyRows = [];
  });

  /**
   * Nouveau trafic : `message_text_keys.sender_public_key` est NULL. La clé
   * publique X25519 de l'expéditeur est transportée DANS le payload sealed
   * sender v3 (vérifié) → le message doit se déchiffrer quand même.
   */
  it('déchiffre SANS sender_public_key stocké (clé via payload v3)', async () => {
    const alice = generateX25519KeyPair();       // expéditeur
    const bob = generateX25519KeyPair();         // destinataire
    const aliceSign = generateSigningKeyPair();
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };
    h.signingKeys['alice-id'] = aliceSign.publicKey;

    const { ciphertextB64, ivB64, rawKey } = await encryptText('message secret');
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );
    const context = {
      conversationId: 'conv',
      messageId: 'm-sealed',
      contentHash: await sealedContentHash(ciphertextB64),
    };
    const blob = await sealSenderForRecipient(bob.publicKey, 'alice-id', aliceSign.privateKey, context, {
      x25519Key: alice.publicKey,
    });

    h.textKeyRows = [
      { message_id: 'm-sealed', encrypted_key: wrapped.encryptedKey, iv: wrapped.iv, sender_public_key: null },
    ];
    const rows = [
      {
        id: 'm-sealed',
        conversation_id: 'conv',
        content: ciphertextB64,
        is_text_encrypted: true,
        encryption_metadata: { v: 1, iv: ivB64 },
        sender_id: 'alice-id',
        sender_sealed: [blob],
      },
    ];

    await decryptMessageRows(rows, 'bob-id');
    expect(rows[0].content).toBe('message secret');
  });

  /**
   * Repli : le scellé ne transporte PAS `xk` (ou est absent), mais
   * `profiles.x25519_public_key(alice)` fournit la clé → déchiffrement OK.
   */
  it('déchiffre via profiles.x25519_public_key quand le scellé ne porte pas xk', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const aliceSign = generateSigningKeyPair();
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };
    h.signingKeys['alice-id'] = aliceSign.publicKey;
    h.x25519Keys['alice-id'] = alice.publicKey;

    const { ciphertextB64, ivB64, rawKey } = await encryptText('derive');
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );
    const context = {
      conversationId: 'conv',
      messageId: 'm-derived',
      contentHash: await sealedContentHash(ciphertextB64),
    };
    // Scellé v3 SANS clés d'identité transportées.
    const blob = await sealSenderForRecipient(bob.publicKey, 'alice-id', aliceSign.privateKey, context);

    h.textKeyRows = [
      { message_id: 'm-derived', encrypted_key: wrapped.encryptedKey, iv: wrapped.iv, sender_public_key: null },
    ];
    const rows = [
      {
        id: 'm-derived',
        conversation_id: 'conv',
        content: ciphertextB64,
        is_text_encrypted: true,
        encryption_metadata: { v: 1, iv: ivB64 },
        sender_id: 'alice-id',
        sender_sealed: [blob],
      },
    ];

    await decryptMessageRows(rows, 'bob-id');
    expect(rows[0].content).toBe('derive');
  });

  /**
   * Ancien trafic : la colonne `sender_public_key` est peuplée → le message
   * historique continue de se déchiffrer (zéro régression).
   */
  it('déchiffre un ANCIEN message AVEC sender_public_key (rétrocompat)', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };

    const { ciphertextB64, ivB64, rawKey } = await encryptText('ancien message');
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );

    h.textKeyRows = [
      { message_id: 'm-legacy', encrypted_key: wrapped.encryptedKey, iv: wrapped.iv, sender_public_key: alice.publicKey },
    ];
    const rows = [
      {
        id: 'm-legacy',
        conversation_id: 'conv',
        content: ciphertextB64,
        is_text_encrypted: true,
        encryption_metadata: { v: 1, iv: ivB64 },
        sender_id: 'alice-id',
      },
    ];

    await decryptMessageRows(rows, 'bob-id');
    expect(rows[0].content).toBe('ancien message');
  });

  /**
   * Repli « clé absente » : ni colonne `sender_public_key`, ni `xk` (scellé
   * absent/illisible), ni `sender_id` exploitable. La seule clé qui déchiffre
   * l'enveloppe (liée par AAD à l'expéditeur) est celle d'un MEMBRE de la
   * conversation → déchiffrement ET attribution de l'expéditeur.
   */
  it('déchiffre et attribue via la clé d\'un membre (sans colonne ni xk)', async () => {
    const alice = generateX25519KeyPair();   // expéditeur (membre)
    const bob = generateX25519KeyPair();     // destinataire / lecteur
    h.recipient = { publicKey: bob.publicKey, privateKey: bob.privateKey };
    h.members = { conv: ['alice-id', 'bob-id'] };
    h.x25519Keys = { 'alice-id': alice.publicKey };

    const { ciphertextB64, ivB64, rawKey } = await encryptText('candidat');
    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
      keyWrapAad(alice.publicKey),
    );

    h.textKeyRows = [
      { message_id: 'm-cand', encrypted_key: wrapped.encryptedKey, iv: wrapped.iv, sender_public_key: null },
    ];
    const rows: Array<{
      id: string;
      conversation_id: string;
      content: string;
      is_text_encrypted: boolean;
      encryption_metadata: unknown;
      sender_id: string | null;
      sender_sealed?: unknown;
    }> = [
      {
        id: 'm-cand',
        conversation_id: 'conv',
        content: ciphertextB64,
        is_text_encrypted: true,
        encryption_metadata: { v: 1, iv: ivB64 },
        sender_id: null,
      },
    ];

    await decryptMessageRows(rows, 'bob-id');
    expect(rows[0].content).toBe('candidat');
    expect(rows[0].sender_id).toBe('alice-id');
  });
});
