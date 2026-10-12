// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Vérifie que `fetchX25519PublicKeys` AUTHENTIFIE la clé X25519 en la liant au
 * COMPTE : un serveur qui recopie le tuple (clé + sig + signataire) d'Alice
 * dans la ligne de Bob ne peut plus faire passer la clé d'Alice pour celle de
 * Bob (la signature v2 couvre le `userId`).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { generateX25519KeyPair, signX25519PublicKey } from './x25519';

const h = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock('@/lib/supabase', () => {
  const chain: any = {
    select: () => chain,
    in: () => chain,
    not: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) => resolve({ data: h.rows, error: null }),
  };
  return { supabase: { from: () => chain } };
});

import { fetchX25519PublicKeys } from './e2eeX25519';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe('e2eeX25519 — signature de clé liée au compte (anti-substitution serveur)', () => {
  beforeEach(() => {
    h.rows = [];
    try {
      localStorage.clear();
    } catch {
      // localStorage indisponible → pas de pin à nettoyer
    }
  });

  it('REFUSE la clé d\'Alice recopiée sous l\'id de Bob (liage userId)', async () => {
    const aliceKey = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signingPub = b64(ed25519.getPublicKey(seed));
    // Signature produite POUR Alice (userId = alice-id).
    const sig = signX25519PublicKey(b64(seed), aliceKey.publicKey, 'alice-id');

    // Le serveur recopie le tuple d'Alice dans la ligne de Bob.
    h.rows = [
      {
        id: 'bob-id',
        x25519_public_key: aliceKey.publicKey,
        x25519_public_key_sig: sig,
        x25519_signing_key: signingPub,
        ratchet_signing_key: null,
      },
    ];

    const map = await fetchX25519PublicKeys(['bob-id']);
    expect(map.has('bob-id')).toBe(false);
    expect(map.size).toBe(0);
  });

  it('accepte la clé signée POUR ce compte', async () => {
    const bobKey = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signingPub = b64(ed25519.getPublicKey(seed));
    const sig = signX25519PublicKey(b64(seed), bobKey.publicKey, 'bob-id');

    h.rows = [
      {
        id: 'bob-id',
        x25519_public_key: bobKey.publicKey,
        x25519_public_key_sig: sig,
        x25519_signing_key: signingPub,
        ratchet_signing_key: null,
      },
    ];

    const map = await fetchX25519PublicKeys(['bob-id']);
    expect(map.get('bob-id')).toBe(bobKey.publicKey);
  });

  it('accepte encore une signature v1 legacy (clé publiée avant le liage au compte)', async () => {
    const bobKey = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signingPub = b64(ed25519.getPublicKey(seed));
    const legacySig = signX25519PublicKey(b64(seed), bobKey.publicKey); // v1

    h.rows = [
      {
        id: 'bob-id',
        x25519_public_key: bobKey.publicKey,
        x25519_public_key_sig: legacySig,
        x25519_signing_key: signingPub,
        ratchet_signing_key: null,
      },
    ];

    const map = await fetchX25519PublicKeys(['bob-id']);
    expect(map.get('bob-id')).toBe(bobKey.publicKey);
  });
});
