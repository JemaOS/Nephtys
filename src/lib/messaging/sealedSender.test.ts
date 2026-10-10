// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair, deriveX25519PublicKey } from '../x25519';
import { generateSigningKeyPair } from '../ratchet/x3dh';
import {
  sealSenderForRecipient,
  openSealedSender,
  parseSealedSenderPayload,
  verifySealedSender,
  findVerifiedSender,
} from './sealedSender';

describe('sealed sender authentifié (Phase 1c — anti-usurpation)', () => {
  it('roundtrip : le destinataire ouvre le blob et retrouve l\'expéditeur vérifié', async () => {
    const alice = generateX25519KeyPair();       // destinataire
    const dave = generateSigningKeyPair();        // expéditeur (clé de signature)
    const senderId = '6c9f1e6e-1111-2222-3333-444455556666';

    const blob = await sealSenderForRecipient(alice.publicKey, senderId, dave.privateKey);
    const raw = await openSealedSender(alice.privateKey, blob);
    const payload = parseSealedSenderPayload(raw);
    expect(payload?.senderId).toBe(senderId);
    expect(verifySealedSender(payload!, dave.publicKey)).toBe(true);
  });

  it('n\'expose pas l\'identifiant de l\'expéditeur en clair (opaque pour le serveur)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const senderId = 'SENTINEL-SENDER-ID-1234567890';

    const blob = await sealSenderForRecipient(alice.publicKey, senderId, dave.privateKey);
    const raw = atob(blob);
    expect(raw.includes('SENTINEL')).toBe(false);
    expect(raw.includes(senderId)).toBe(false);
  });

  it('un autre destinataire ne peut PAS ouvrir le blob', async () => {
    const alice = generateX25519KeyPair();
    const eve = generateX25519KeyPair();
    const dave = generateSigningKeyPair();

    const blob = await sealSenderForRecipient(alice.publicKey, 'dave-id', dave.privateKey);
    await expect(openSealedSender(eve.privateKey, blob)).rejects.toBeTruthy();
  });

  it('échoue si le blob est altéré (AES-GCM authentifié)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const blob = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey);
    const bytes = Uint8Array.from(atob(blob), c => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(openSealedSender(alice.privateKey, tampered)).rejects.toBeTruthy();
  });

  it('findVerifiedSender retrouve le bon blob et vérifie la signature', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const keys: Record<string, string> = { dave: dave.publicKey };
    const getSigningKey = async (id: string) => keys[id] ?? null;

    const blobs = [
      await sealSenderForRecipient(bob.publicKey, 'dave', dave.privateKey),
      await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey),
    ];

    expect(await findVerifiedSender(alice.privateKey, blobs, getSigningKey)).toBe('dave');
    expect(await findVerifiedSender(bob.privateKey, blobs, getSigningKey)).toBe('dave');

    const stranger = generateX25519KeyPair();
    expect(await findVerifiedSender(stranger.privateKey, blobs, getSigningKey)).toBeNull();
  });

  it('REJETTE l\'usurpation : sceller l\'id d\'un autre avec SA propre clé échoue', async () => {
    const alice = generateX25519KeyPair();
    const victimSign = generateSigningKeyPair();   // clé publiée de la victime
    const attackerSign = generateSigningKeyPair();  // clé de l'attaquant

    // L'attaquant scelle « victim » mais signe avec SA clé.
    const forged = await sealSenderForRecipient(alice.publicKey, 'victim', attackerSign.privateKey);
    const keys: Record<string, string> = { victim: victimSign.publicKey };
    const getSigningKey = async (id: string) => keys[id] ?? null;

    // La vérification utilise la clé PUBLIÉE de « victim » → échoue → null.
    expect(await findVerifiedSender(alice.privateKey, [forged], getSigningKey)).toBeNull();
  });

  it('accepte une clé publique dérivée', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const derivedPub = deriveX25519PublicKey(alice.privateKey);
    const blob = await sealSenderForRecipient(derivedPub, 'dave', dave.privateKey);
    const raw = await openSealedSender(alice.privateKey, blob);
    expect(parseSealedSenderPayload(raw)?.senderId).toBe('dave');
  });
});
