import { describe, it, expect } from 'vitest';
import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  deriveMasterSeed,
  deriveLocalRatchetKeys,
  deriveUserX25519KeyPair,
} from './keysFromPhrase';
import { signPreKey, verifyPreKey } from '../ratchet/x3dh';

const PHRASE_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('phrase de récupération', () => {
  it('génère 24 mots valides', () => {
    const phrase = generateRecoveryPhrase();
    expect(phrase.split(' ')).toHaveLength(24);
    expect(validateRecoveryPhrase(phrase)).toBe(true);
  });

  it('valide les phrases BIP-39 et rejette les autres', () => {
    expect(validateRecoveryPhrase(PHRASE_A)).toBe(true);
    expect(validateRecoveryPhrase('abandon abandon abandon')).toBe(false);
    expect(validateRecoveryPhrase('')).toBe(false);
    expect(validateRecoveryPhrase('not a real phrase at all nope nope nope')).toBe(false);
  });

  it('rejette une phrase invalide à la dérivation', () => {
    expect(() => deriveMasterSeed('trop court')).toThrow(/invalide/i);
  });
});

describe('dérivation déterministe', () => {
  it('produit EXACTEMENT les mêmes clés pour la même phrase', async () => {
    const k1 = await deriveLocalRatchetKeys(PHRASE_A);
    const k2 = await deriveLocalRatchetKeys(PHRASE_A);
    expect(k2.identityKeyPair).toEqual(k1.identityKeyPair);
    expect(k2.signingKeyPair).toEqual(k1.signingKeyPair);
    expect(k2.signedPreKey).toEqual(k1.signedPreKey);
    expect(k2.mlKemKeyPair).toEqual(k1.mlKemKeyPair);
    expect(k2.oneTimePreKeys).toEqual(k1.oneTimePreKeys);
  });

  it('produit des clés DIFFÉRENTES pour une autre phrase', async () => {
    const a = await deriveLocalRatchetKeys(PHRASE_A);
    const b = await deriveLocalRatchetKeys(PHRASE_B);
    expect(b.identityKeyPair.publicKey).not.toBe(a.identityKeyPair.publicKey);
    expect(b.signingKeyPair.publicKey).not.toBe(a.signingKeyPair.publicKey);
    expect(b.mlKemKeyPair?.publicKey).not.toBe(a.mlKemKeyPair?.publicKey);
  });

  it('génère le bon nombre de one-time prekeys', async () => {
    const k = await deriveLocalRatchetKeys(PHRASE_A, 5);
    expect(Object.keys(k.oneTimePreKeys)).toHaveLength(5);
  });

  it('la clé X25519 user est déterministe et stable', async () => {
    const p1 = await deriveUserX25519KeyPair(PHRASE_A);
    const p2 = await deriveUserX25519KeyPair(PHRASE_A);
    expect(p2).toEqual(p1);
    expect(p1.publicKey).not.toBe('');
  });

  it('le bundle dérivé se signe et se vérifie (anti-MITM)', async () => {
    const k = await deriveLocalRatchetKeys(PHRASE_A);
    const sig = signPreKey(
      k.signingKeyPair.privateKey,
      k.signedPreKey.publicKey,
      k.mlKemKeyPair?.publicKey,
    );
    expect(
      verifyPreKey({
        identityKey: k.identityKeyPair.publicKey,
        signingKey: k.signingKeyPair.publicKey,
        signedPreKey: k.signedPreKey.publicKey,
        signedPreKeySignature: sig,
        oneTimePreKey: null,
        mlKemPublicKey: k.mlKemKeyPair?.publicKey ?? null,
      }),
    ).toBe(true);
  });
});
