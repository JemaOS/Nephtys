// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect, vi } from 'vitest';
import { generateX25519KeyPair } from './x25519';
import { generateSigningKeyPair } from './ratchet/x3dh';
import { sealSenderForRecipient } from './messaging/sealedSender';

const h = vi.hoisted(() => ({
  signingKeys: {} as Record<string, string>,
  recipient: null as { publicKey: string; privateKey: string } | null,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: async () => ({ data: { ratchet_signing_key: h.signingKeys[id] ?? null } }),
        }),
      }),
    }),
  },
}));

vi.mock('@/lib/e2eeX25519', () => ({
  getLocalX25519KeyPair: async () => h.recipient,
  fetchX25519PublicKeys: async () => new Map(),
}));

import { resolveSealedSenders } from './textEncryption';

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
