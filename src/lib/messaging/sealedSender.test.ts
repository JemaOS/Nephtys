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
  findVerifiedSenderIdentity,
  sealedContentHash,
  isAfterV2Sunset,
  V2_SUNSET_ISO,
  type SealedSenderContext,
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

describe('sealed sender v3 — non rejouable (liaison au contexte)', () => {
  async function makeContext(over: Partial<SealedSenderContext> = {}): Promise<SealedSenderContext> {
    return {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash('ciphertext-of-msg-1'),
      ...over,
    };
  }

  it('v3 : le destinataire vérifie le contexte et retrouve l\'expéditeur', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const senderId = 'dave-id';
    const ctx = await makeContext();

    const blob = await sealSenderForRecipient(alice.publicKey, senderId, dave.privateKey, ctx);
    const raw = await openSealedSender(alice.privateKey, blob);
    const payload = parseSealedSenderPayload(raw);
    expect(payload?.version).toBe(3);
    expect(payload?.senderId).toBe(senderId);
    expect(verifySealedSender(payload!, dave.publicKey, ctx)).toBe(true);
  });

  it('REJETTE un blob v3 recopié sur un AUTRE message (contexte différent)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const senderId = 'dave-id';
    const ctx = await makeContext();

    const blob = await sealSenderForRecipient(alice.publicKey, senderId, dave.privateKey, ctx);
    const raw = await openSealedSender(alice.privateKey, blob);
    const payload = parseSealedSenderPayload(raw)!;

    // Même blob, mais on l'attribue au message « msg-2 » / contenu différent.
    const otherCtx = await makeContext({ messageId: 'msg-2', contentHash: await sealedContentHash('autre') });
    expect(verifySealedSender(payload, dave.publicKey, otherCtx)).toBe(false);
    expect(verifySealedSender(payload, dave.publicKey, await makeContext({ conversationId: 'conv-2' }))).toBe(false);
    expect(verifySealedSender(payload, dave.publicKey, await makeContext({ contentHash: await sealedContentHash('x') }))).toBe(false);

    const getSigningKey = async (id: string) => (id === senderId ? dave.publicKey : null);
    expect(await findVerifiedSender(alice.privateKey, [blob], getSigningKey, ctx)).toBe(senderId);
    expect(await findVerifiedSender(alice.privateKey, [blob], getSigningKey, otherCtx)).toBeNull();
  });

  it('REJETTE un blob v3 sans contexte (la signature couvre le contexte)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const ctx = await makeContext();

    const blob = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey, ctx);
    const raw = await openSealedSender(alice.privateKey, blob);
    const payload = parseSealedSenderPayload(raw)!;
    // Sans contexte, impossible de vérifier une signature v3 → refus.
    expect(verifySealedSender(payload, dave.publicKey)).toBe(false);
  });

  it('rétrocompat : un payload sans `v` est traité comme v2', () => {
    const parsed = parseSealedSenderPayload(JSON.stringify({ s: 'dave', sig: 'AAAA' }));
    expect(parsed?.version).toBe(2);
    expect(parsed?.senderId).toBe('dave');
  });

  it('rétrocompat : un blob v2 (sans contexte) reste résolu par findVerifiedSender', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    // Pas de contexte → scellement v2 (comportement historique).
    const blobV2 = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey);
    const raw = await openSealedSender(alice.privateKey, blobV2);
    expect(parseSealedSenderPayload(raw)?.version).toBe(2);

    const getSigningKey = async (id: string) => (id === 'dave' ? dave.publicKey : null);
    expect(await findVerifiedSender(alice.privateKey, [blobV2], getSigningKey)).toBe('dave');
  });
});

describe('sealed sender — transport des clés d\'identité (anti-métadonnée)', () => {
  it('v3 : transporte xk/ik et les restitue APRÈS vérification', async () => {
    const alice = generateX25519KeyPair();       // destinataire
    const dave = generateSigningKeyPair();        // expéditeur
    const ctx: SealedSenderContext = {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash('ct'),
    };
    const xk = generateX25519KeyPair().publicKey;
    const ik = 'IDENTITY-X3DH-PUB-B64';

    const blob = await sealSenderForRecipient(alice.publicKey, 'dave-id', dave.privateKey, ctx, {
      x25519Key: xk,
      identityKey: ik,
    });

    const getSigningKey = async (id: string) => (id === 'dave-id' ? dave.publicKey : null);
    const resolved = await findVerifiedSenderIdentity(alice.privateKey, [blob], getSigningKey, ctx);
    expect(resolved).toEqual({ senderId: 'dave-id', x25519Key: xk, identityKey: ik });

    // La clé publique n'apparaît pas en clair dans le blob (opaque serveur).
    const raw = atob(blob);
    expect(raw.includes(xk)).toBe(false);
    expect(raw.includes(ik)).toBe(false);
  });

  it('rétrocompat : un blob v3 sans clés transportées reste résoluble', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const ctx: SealedSenderContext = {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash('ct'),
    };
    const blob = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey, ctx);
    const getSigningKey = async () => dave.publicKey;
    const resolved = await findVerifiedSenderIdentity(alice.privateKey, [blob], getSigningKey, ctx);
    expect(resolved?.senderId).toBe('dave');
    expect(resolved?.x25519Key).toBeUndefined();
    expect(resolved?.identityKey).toBeUndefined();
  });
});

describe('sealed sender — bascule v2 → v3 (V2_SUNSET_ISO)', () => {
  it('isAfterV2Sunset : date postérieure = true, antérieure/absente = false', () => {
    // Défaut = date de mise en service de la v3 (PASSÉE) → la v2 est fermée
    // pour tout message créé après cette date.
    expect(V2_SUNSET_ISO).toBe('2026-10-12T00:00:00Z');
    expect(isAfterV2Sunset('2026-10-12T00:00:00Z')).toBe(true);
    expect(isAfterV2Sunset('2026-10-13T12:00:00+00:00')).toBe(true);
    expect(isAfterV2Sunset(new Date().toISOString())).toBe(true);
    expect(isAfterV2Sunset('2026-09-01T00:00:00Z')).toBe(false);
    expect(isAfterV2Sunset('2026-10-11T23:59:59Z')).toBe(false);
    expect(isAfterV2Sunset(null)).toBe(false);
    expect(isAfterV2Sunset(undefined)).toBe(false);
    expect(isAfterV2Sunset('pas-une-date')).toBe(false);
  });

  it('REFUSE un blob v2 sur un message créé MAINTENANT (rejeu v2 fermé)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    // Blob v2 : pas de contexte → signature liée au seul senderId (rejouable).
    const blobV2 = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey);
    const getSigningKey = async (id: string) => (id === 'dave' ? dave.publicKey : null);

    const createdAt = new Date().toISOString();
    // Le défaut (date passée) classe un message d'aujourd'hui APRÈS la bascule…
    expect(isAfterV2Sunset(createdAt)).toBe(true);
    // …donc la v2 est refusée → expéditeur NON attribué.
    const resolved = await findVerifiedSenderIdentity(alice.privateKey, [blobV2], getSigningKey, undefined, {
      rejectUnboundV2: isAfterV2Sunset(createdAt),
    });
    expect(resolved).toBeNull();
  });

  it('ACCEPTE un blob v2 sur un message du 2026-09-01 (rétrocompat historique)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const blobV2 = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey);
    const getSigningKey = async (id: string) => (id === 'dave' ? dave.publicKey : null);

    const createdAt = '2026-09-01T00:00:00Z';
    expect(isAfterV2Sunset(createdAt)).toBe(false);
    const resolved = await findVerifiedSenderIdentity(alice.privateKey, [blobV2], getSigningKey, undefined, {
      rejectUnboundV2: isAfterV2Sunset(createdAt),
    });
    expect(resolved?.senderId).toBe('dave');
  });

  it('rejette un blob v2 quand rejectUnboundV2 (message postérieur)', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    // Blob v2 : pas de contexte → signature liée au seul senderId (rejouable).
    const blobV2 = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey);
    const getSigningKey = async (id: string) => (id === 'dave' ? dave.publicKey : null);

    // Sans bascule → résolu (rétrocompat).
    expect(await findVerifiedSenderIdentity(alice.privateKey, [blobV2], getSigningKey)).not.toBeNull();
    // Après bascule → refusé (non attribué).
    expect(
      await findVerifiedSenderIdentity(alice.privateKey, [blobV2], getSigningKey, undefined, {
        rejectUnboundV2: true,
      }),
    ).toBeNull();
  });

  it('accepte toujours un blob v3 (lié au contexte) après la bascule', async () => {
    const alice = generateX25519KeyPair();
    const dave = generateSigningKeyPair();
    const ctx: SealedSenderContext = {
      conversationId: 'conv-1',
      messageId: 'msg-1',
      contentHash: await sealedContentHash('ct'),
    };
    const blobV3 = await sealSenderForRecipient(alice.publicKey, 'dave', dave.privateKey, ctx);
    const getSigningKey = async (id: string) => (id === 'dave' ? dave.publicKey : null);
    const resolved = await findVerifiedSenderIdentity(alice.privateKey, [blobV3], getSigningKey, ctx, {
      rejectUnboundV2: true,
    });
    expect(resolved?.senderId).toBe('dave');
  });
});
