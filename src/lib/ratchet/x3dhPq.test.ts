// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

import { describe, it, expect } from 'vitest';
import { generateX25519KeyPair } from './primitives';
import {
  generateIdentityKeyPair,
  generateSigningKeyPair,
  signPreKey,
  x3dhInitiate,
  x3dhRespond,
  type PreKeyBundle,
} from './x3dh';
import { generateMlKemKeyPair } from './pqKem';

function responderSetup(withPq: boolean) {
  const identity = generateIdentityKeyPair();
  const sign = generateSigningKeyPair();
  const signedPreKey = generateX25519KeyPair();
  const oneTimePreKey = generateX25519KeyPair();
  const mlKem = withPq ? generateMlKemKeyPair() : null;

  const bundle: PreKeyBundle = {
    identityKey: identity.publicKey,
    signingKey: sign.publicKey,
    signedPreKey: signedPreKey.publicKey,
    signedPreKeySignature: signPreKey(sign.privateKey, signedPreKey.publicKey),
    oneTimePreKey: oneTimePreKey.publicKey,
    mlKemPublicKey: mlKem?.publicKey ?? null,
  };
  return { identity, signedPreKey, oneTimePreKey, mlKem, bundle };
}

describe('X3DH hybride post-quantique (ML-KEM)', () => {
  it('initiateur et destinataire dérivent le MÊME secret (avec PQ)', async () => {
    const bob = responderSetup(true);
    const alice = generateIdentityKeyPair();

    const init = await x3dhInitiate(alice, bob.bundle);
    expect(init.mlKemCiphertext).toBeTruthy();

    const resp = await x3dhRespond(
      bob.identity,
      bob.signedPreKey,
      bob.oneTimePreKey,
      alice.publicKey,
      init.ephemeralPublicKey,
      init.mlKemCiphertext ?? null,
      bob.mlKem?.secretKey ?? null,
    );

    expect(Array.from(resp.rootKey)).toEqual(Array.from(init.rootKey));
    expect(Array.from(resp.associatedData)).toEqual(Array.from(init.associatedData));
  });

  it('rétro-compat : sans clé PQ, le secret reste identique (chemin classique)', async () => {
    const bob = responderSetup(false);
    const alice = generateIdentityKeyPair();

    const init = await x3dhInitiate(alice, bob.bundle);
    expect(init.mlKemCiphertext ?? null).toBeNull();

    const resp = await x3dhRespond(
      bob.identity,
      bob.signedPreKey,
      bob.oneTimePreKey,
      alice.publicKey,
      init.ephemeralPublicKey,
    );

    expect(Array.from(resp.rootKey)).toEqual(Array.from(init.rootKey));
  });

  it('PQ ≠ classique : le secret change quand la clé PQ est utilisée', async () => {
    const bobPq = responderSetup(true);
    const bobClassic = responderSetup(false);
    const alice = generateIdentityKeyPair();

    const initPq = await x3dhInitiate(alice, bobPq.bundle);
    const initClassic = await x3dhInitiate(alice, bobClassic.bundle);
    expect(Array.from(initPq.rootKey)).not.toEqual(Array.from(initClassic.rootKey));
  });
});
