import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  deriveX25519PublicKey,
  isX25519PublicKey,
  tagX25519,
  untagX25519,
  wrapKeyForRecipientX25519,
  unwrapKeyFromSenderX25519,
  keyWrapAad,
  signX25519PublicKey,
  verifyX25519PublicKeySignature,
} from './x25519';
import { ed25519 } from '@noble/curves/ed25519.js';

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe('x25519', () => {
  it('generates a tagged keypair whose public key derives from the private key', () => {
    const kp = generateX25519KeyPair();
    expect(isX25519PublicKey(kp.publicKey)).toBe(true);
    expect(deriveX25519PublicKey(kp.privateKey)).toBe(kp.publicKey);
  });

  it('tags and untags public keys idempotently', () => {
    expect(tagX25519('abc')).toBe('x25519:abc');
    expect(tagX25519('x25519:abc')).toBe('x25519:abc');
    expect(untagX25519('x25519:abc')).toBe('abc');
    expect(untagX25519('abc')).toBe('abc');
    expect(isX25519PublicKey('abc')).toBe(false);
    expect(isX25519PublicKey(null)).toBe(false);
  });

  it('wraps and unwraps a symmetric key between two parties', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));

    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
    );
    expect(wrapped.senderPublicKey).toBe(alice.publicKey);

    const unwrapped = await unwrapKeyFromSenderX25519(wrapped, bob.privateKey);
    expect(Array.from(unwrapped)).toEqual(Array.from(rawKey));
  });

  it('fails to unwrap with the wrong private key', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const eve = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));

    const wrapped = await wrapKeyForRecipientX25519(
      rawKey,
      alice.privateKey,
      alice.publicKey,
      bob.publicKey,
    );

    await expect(unwrapKeyFromSenderX25519(wrapped, eve.privateKey)).rejects.toBeTruthy();
  });

  it('lie l’enveloppe à un AAD et la déchiffre avec le même AAD', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const aad = keyWrapAad(alice.publicKey);
    const wrapped = await wrapKeyForRecipientX25519(rawKey, alice.privateKey, alice.publicKey, bob.publicKey, aad);
    const unwrapped = await unwrapKeyFromSenderX25519(wrapped, bob.privateKey, aad);
    expect(Array.from(unwrapped)).toEqual(Array.from(rawKey));
  });

  it('rejette un déchiffrement avec un AAD différent', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapKeyForRecipientX25519(rawKey, alice.privateKey, alice.publicKey, bob.publicKey, keyWrapAad(alice.publicKey));
    await expect(unwrapKeyFromSenderX25519(wrapped, bob.privateKey, keyWrapAad('x25519:autre'))).rejects.toBeTruthy();
  });

  it('rejette par défaut une enveloppe sans AAD (pas de repli silencieux)', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    // Enveloppe historique émise SANS AAD.
    const legacy = await wrapKeyForRecipientX25519(rawKey, alice.privateKey, alice.publicKey, bob.publicKey);
    // Sans opt-in explicite, fournir un AAD n'autorise PAS le repli sans AAD.
    await expect(
      unwrapKeyFromSenderX25519(legacy, bob.privateKey, keyWrapAad(alice.publicKey)),
    ).rejects.toBeTruthy();
  });

  it('déchiffre les enveloppes historiques SANS AAD UNIQUEMENT si explicitement autorisé', async () => {
    const alice = generateX25519KeyPair();
    const bob = generateX25519KeyPair();
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const legacy = await wrapKeyForRecipientX25519(rawKey, alice.privateKey, alice.publicKey, bob.publicKey);
    const unwrapped = await unwrapKeyFromSenderX25519(
      legacy,
      bob.privateKey,
      keyWrapAad(alice.publicKey),
      { allowLegacyNoAad: true },
    );
    expect(Array.from(unwrapped)).toEqual(Array.from(rawKey));
  });

  it('signe et vérifie la clé publique X25519 (Ed25519)', () => {
    const kp = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signerPriv = b64(seed);
    const signerPub = b64(ed25519.getPublicKey(seed));

    const sig = signX25519PublicKey(signerPriv, kp.publicKey);
    expect(verifyX25519PublicKeySignature(signerPub, kp.publicKey, sig)).toBe(true);
    // Mauvaise clé → signature invalide.
    expect(verifyX25519PublicKeySignature(signerPub, 'x25519:autre', sig)).toBe(false);
    // Mauvais signataire → invalide.
    const otherSeed = crypto.getRandomValues(new Uint8Array(32));
    expect(verifyX25519PublicKeySignature(b64(ed25519.getPublicKey(otherSeed)), kp.publicKey, sig)).toBe(false);
  });

  it('lie la signature de clé au COMPTE : la clé d\'Alice est refusée sous l\'id de Bob', () => {
    const aliceKey = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signerPriv = b64(seed);
    const signerPub = b64(ed25519.getPublicKey(seed));

    // Alice signe SA clé en étant liée à SON compte.
    const sig = signX25519PublicKey(signerPriv, aliceKey.publicKey, 'alice-id');

    // Vérifiée sous l'id d'Alice → OK.
    expect(verifyX25519PublicKeySignature(signerPub, aliceKey.publicKey, sig, 'alice-id')).toBe(true);
    // Recopiée sous l'id de Bob → REFUSÉE (le serveur ne peut pas substituer).
    expect(verifyX25519PublicKeySignature(signerPub, aliceKey.publicKey, sig, 'bob-id')).toBe(false);
    // Même la « bonne » clé mais un autre userId échoue.
    expect(verifyX25519PublicKeySignature(signerPub, aliceKey.publicKey, sig, 'carol-id')).toBe(false);
  });

  it('accepte encore une signature v1 legacy (publiée avant le liage au compte)', () => {
    const kp = generateX25519KeyPair();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const signerPriv = b64(seed);
    const signerPub = b64(ed25519.getPublicKey(seed));

    // v1 : pas de userId → signature non liée au compte (format historique).
    const legacySig = signX25519PublicKey(signerPriv, kp.publicKey);
    // Rétrocompat : acceptée même quand l'appelant fournit un userId.
    expect(verifyX25519PublicKeySignature(signerPub, kp.publicKey, legacySig, 'alice-id')).toBe(true);
    expect(verifyX25519PublicKeySignature(signerPub, kp.publicKey, legacySig)).toBe(true);
  });
});
