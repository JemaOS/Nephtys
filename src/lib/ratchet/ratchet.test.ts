import { describe, it, expect } from 'vitest';
import {
  generateIdentityKeyPair,
  generateSigningKeyPair,
  generateOneTimePreKeys,
  signPreKey,
  verifyPreKey,
  x3dhInitiate,
  x3dhRespond,
  initSenderSession,
  initReceiverSession,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeSession,
  deserializeSession,
  type PreKeyBundle,
  type SessionState,
} from './index';
import { generateX25519KeyPair } from './primitives';

/** Établit une paire de sessions (Alice initiatrice, Bob destinataire). */
async function establish() {
  const aliceId = generateIdentityKeyPair();
  const bobId = generateIdentityKeyPair();
  const bobSign = generateSigningKeyPair();
  const bobSpk = generateX25519KeyPair();
  const [bobOpk] = generateOneTimePreKeys(1);

  const bundle: PreKeyBundle = {
    identityKey: bobId.publicKey,
    signingKey: bobSign.publicKey,
    signedPreKey: bobSpk.publicKey,
    signedPreKeySignature: signPreKey(bobSign.privateKey, bobSpk.publicKey),
    oneTimePreKey: bobOpk.publicKey,
  };

  const init = await x3dhInitiate(aliceId, bundle);
  const alice = await initSenderSession(
    init.rootKey,
    bundle.signedPreKey,
    init.associatedData,
    init.ratchetKeyPair,
  );
  const resp = await x3dhRespond(bobId, bobSpk, bobOpk, aliceId.publicKey, init.ephemeralPublicKey);
  const bob = initReceiverSession(resp.rootKey, bobSpk, resp.associatedData);

  return { alice, bob, bundle, aliceId, bobSign };
}

async function send(from: SessionState, to: SessionState, text: string): Promise<void> {
  const msg = await ratchetEncrypt(from, text);
  expect(await ratchetDecrypt(to, msg)).toBe(text);
}

describe('X3DH + Double Ratchet', () => {
  it('rejects a bundle whose signed prekey signature is invalid', async () => {
    const { bundle } = await establish();
    const tampered: PreKeyBundle = {
      ...bundle,
      signedPreKeySignature: signPreKey(generateSigningKeyPair().privateKey, 'aaaa'),
    };
    expect(verifyPreKey(tampered)).toBe(false);
    await expect(x3dhInitiate(generateIdentityKeyPair(), tampered)).rejects.toThrow(/signature/);
  });

  it('round-trips a single message', async () => {
    const { alice, bob } = await establish();
    await send(alice, bob, 'bonjour');
  });

  it('supports a bidirectional conversation (DH ratchet on each turn)', async () => {
    const { alice, bob } = await establish();
    await send(alice, bob, 'a1');
    await send(alice, bob, 'a2');
    await send(bob, alice, 'b1');
    await send(alice, bob, 'a3'); // nouveau ratchet après réponse de Bob
    await send(bob, alice, 'b2');
  });

  it('handles out-of-order delivery via skipped keys', async () => {
    const { alice, bob } = await establish();

    const m1 = await ratchetEncrypt(alice, 'm1');
    const m2 = await ratchetEncrypt(alice, 'm2');
    const m3 = await ratchetEncrypt(alice, 'm3');

    expect(await ratchetDecrypt(bob, m3)).toBe('m3');
    expect(await ratchetDecrypt(bob, m1)).toBe('m1');
    expect(await ratchetDecrypt(bob, m2)).toBe('m2');
  });

  it('uses a distinct key per message (forward secrecy: chain advances)', async () => {
    const { alice } = await establish();
    const a = await ratchetEncrypt(alice, 'x');
    const b = await ratchetEncrypt(alice, 'x');
    // Même clair, mais clés de message et ciphertexts différents.
    expect(a.ctB64).not.toBe(b.ctB64);
    expect(a.header.n).toBe(0);
    expect(b.header.n).toBe(1);
  });

  it('rejects replays and tampered ciphertext', async () => {
    const { alice, bob } = await establish();
    const msg = await ratchetEncrypt(alice, 'secret');
    expect(await ratchetDecrypt(bob, msg)).toBe('secret');
    // Rejeu du même message : la clé a été consommée → échec.
    await expect(ratchetDecrypt(bob, msg)).rejects.toBeTruthy();

    const tampered = await ratchetEncrypt(alice, 'secret2');
    const bytes = Uint8Array.from(atob(tampered.ctB64), c => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    let b64 = '';
    for (const byte of bytes) b64 += String.fromCharCode(byte);
    await expect(ratchetDecrypt(bob, { ...tampered, ctB64: btoa(b64) })).rejects.toBeTruthy();
  });

  it('survives state serialization between messages', async () => {
    const { alice, bob } = await establish();
    const m1 = await ratchetEncrypt(alice, 'm1');
    const bobReloaded = deserializeSession(serializeSession(bob));
    expect(await ratchetDecrypt(bobReloaded, m1)).toBe('m1');

    const r1 = await ratchetEncrypt(bobReloaded, 'r1');
    const aliceReloaded = deserializeSession(serializeSession(alice));
    expect(await ratchetDecrypt(aliceReloaded, r1)).toBe('r1');
  });
});
