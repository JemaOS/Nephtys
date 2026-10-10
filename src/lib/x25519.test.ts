import { describe, it, expect } from 'vitest';
import {
  generateX25519KeyPair,
  deriveX25519PublicKey,
  isX25519PublicKey,
  tagX25519,
  untagX25519,
  wrapKeyForRecipientX25519,
  unwrapKeyFromSenderX25519,
} from './x25519';

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
});
