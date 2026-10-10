// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair, deriveX25519PublicKey } from '../x25519';
import {
  sealSenderForRecipient,
  openSealedSender,
  findMySealedSender,
} from './sealedSender';

describe('sealed sender (Phase 1 — cacher le graphe au serveur)', () => {
  it('ouvre un blob scellé avec la clé du destinataire et retrouve l\'expéditeur', async () => {
    const alice = generateX25519KeyPair(); // destinataire
    const senderId = '6c9f1e6e-1111-2222-3333-444455556666';

    const blob = await sealSenderForRecipient(alice.publicKey, senderId);
    const opened = await openSealedSender(alice.privateKey, blob);
    expect(opened).toBe(senderId);
  });

  it('n\'expose pas l\'identifiant de l\'expéditeur en clair (opaque pour le serveur)', async () => {
    const alice = generateX25519KeyPair();
    const senderId = 'SENTINEL-SENDER-ID-1234567890';

    const blob = await sealSenderForRecipient(alice.publicKey, senderId);
    const raw = atob(blob);
    expect(raw.includes('SENTINEL')).toBe(false);
    expect(raw.includes(senderId)).toBe(false);
  });

  it('un autre destinataire ne peut PAS ouvrir le blob', async () => {
    const alice = generateX25519KeyPair();
    const eve = generateX25519KeyPair();

    const blob = await sealSenderForRecipient(alice.publicKey, 'alice-is-sender');
    await expect(openSealedSender(eve.privateKey, blob)).rejects.toBeTruthy();
  });

  it('échoue si le blob est altéré (AES-GCM authentifié)', async () => {
    const alice = generateX25519KeyPair();
    const blob = await sealSenderForRecipient(alice.publicKey, 'alice');
    const bytes = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff; // corrompt le ciphertext
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(openSealedSender(alice.privateKey, tampered)).rejects.toBeTruthy();
  });

  it('findMySealedSender retrouve le bon blob parmi plusieurs destinataires', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const carol = generateX25519KeyPair();

    // Un message de « dave » scellé pour alice, bob et carol.
    const blobs = [
      await sealSenderForRecipient(bob.publicKey, 'dave'),
      await sealSenderForRecipient(carol.publicKey, 'dave'),
      await sealSenderForRecipient(alice.publicKey, 'dave'),
    ];

    const aliceSees = await findMySealedSender(alice.privateKey, blobs);
    const bobSees = await findMySealedSender(bob.privateKey, blobs);
    expect(aliceSees).toBe('dave');
    expect(bobSees).toBe('dave');

    // Un non-destinataire ne trouve rien.
    const stranger = generateX25519KeyPair();
    expect(await findMySealedSender(stranger.privateKey, blobs)).toBeNull();
  });

  it('accepte une clé publique dérivée (cohérence avec deriveX25519PublicKey)', async () => {
    const alice = generateX25519KeyPair();
    const derivedPub = deriveX25519PublicKey(alice.privateKey);
    const blob = await sealSenderForRecipient(derivedPub, 'sender-x');
    expect(await openSealedSender(alice.privateKey, blob)).toBe('sender-x');
  });
});
