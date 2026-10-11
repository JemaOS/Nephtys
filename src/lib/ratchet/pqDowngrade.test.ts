// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Anti-downgrade post-quantique : si nous (destinataire) avons publié une clé
 * ML-KEM, une enveloppe `ratchet-init` sans partie PQ doit être REFUSÉE
 * (fail-closed) et ne jamais établir de session en mode classique silencieux.
 */

import { describe, it, expect } from 'vitest';
import {
  generateIdentityKeyPair,
  generateSigningKeyPair,
  generateOneTimePreKeys,
  signPreKey,
  type SessionState,
} from './index';
import { generateX25519KeyPair } from './primitives';
import { generateMlKemKeyPair } from './pqKem';
import {
  encryptForPeer,
  decryptFromPeer,
  lacksPqPart,
  assertPqNotDowngraded,
  RatchetPqDowngradeError,
  type LocalRatchetKeys,
  type PeerBundle,
  type RatchetEnvelope,
  type RatchetServiceDeps,
} from './service';

interface TestUser {
  local: LocalRatchetKeys;
  bundle: PeerBundle;
}

/** `withPq = false` simule un compte pré-PQ (aucune clé ML-KEM). */
function makeUser(withPq: boolean): TestUser {
  const identityKeyPair = generateIdentityKeyPair();
  const signingKeyPair = generateSigningKeyPair();
  const signedPreKey = generateX25519KeyPair();
  const opks = generateOneTimePreKeys(5);
  const mlKemKeyPair = withPq ? generateMlKemKeyPair() : undefined;

  const oneTimePreKeys: Record<string, string> = {};
  for (const k of opks) oneTimePreKeys[k.publicKey] = k.privateKey;

  return {
    local: {
      identityKeyPair,
      signingKeyPair,
      signedPreKey,
      oneTimePreKeys,
      ...(mlKemKeyPair ? { mlKemKeyPair } : {}),
    },
    bundle: {
      identityKey: identityKeyPair.publicKey,
      signingKey: signingKeyPair.publicKey,
      signedPreKey: signedPreKey.publicKey,
      signedPreKeySignature: signPreKey(
        signingKeyPair.privateKey,
        signedPreKey.publicKey,
        mlKemKeyPair?.publicKey,
      ),
      oneTimePreKey: opks[0].publicKey,
      mlKemPublicKey: mlKemKeyPair?.publicKey ?? null,
    },
  };
}

function makeDeps(users: Record<string, TestUser>) {
  const sessions = new Map<string, SessionState>();
  const k = (u: string, p: string) => `${u}|${p}`;

  const deps: RatchetServiceDeps = {
    loadLocalKeys: async u => users[u]?.local ?? null,
    loadPeerBundle: async p => users[p]?.bundle ?? null,
    loadPeerIdentityKey: async p => users[p]?.bundle.identityKey ?? null,
    markOneTimePreKeyUsed: async p => {
      if (users[p]) users[p].bundle.oneTimePreKey = null;
    },
    loadSession: async (u, p) => sessions.get(k(u, p)) ?? null,
    saveSession: async (u, p, s) => {
      sessions.set(k(u, p), s);
    },
  };
  return { deps, sessions };
}

describe('anti-downgrade post-quantique (ML-KEM)', () => {
  it('(a) bundle avec ML-KEM mais enveloppe sans PQ → REFUS (fail-closed)', async () => {
    const users = { alice: makeUser(true), bob: makeUser(true) };
    const { deps, sessions } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'top-secret');
    expect(msg.envelope.type).toBe('ratchet-init');
    expect(msg.envelope.pq).toBe(true);
    expect(msg.envelope.mlKemCiphertext).toBeTruthy();

    // MITM/serveur retire la partie post-quantique de l'init.
    const stripped: RatchetEnvelope = {
      ...msg.envelope,
      pq: false,
      mlKemCiphertext: null,
    };
    expect(lacksPqPart(stripped)).toBe(true);

    await expect(
      decryptFromPeer(deps, 'bob', 'conv', stripped, msg.content, 'alice'),
    ).rejects.toBeInstanceOf(RatchetPqDowngradeError);

    // La session dégradée ne doit JAMAIS être établie/stockée.
    expect(sessions.has('bob|conv')).toBe(false);
  });

  it('(a\') un init malformé (pq=true mais ciphertext absent) est aussi refusé', async () => {
    const users = { alice: makeUser(true), bob: makeUser(true) };
    const { deps, sessions } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'x');
    const malformed: RatchetEnvelope = { ...msg.envelope, pq: true, mlKemCiphertext: null };
    expect(lacksPqPart(malformed)).toBe(true);

    await expect(
      decryptFromPeer(deps, 'bob', 'conv', malformed, msg.content, 'alice'),
    ).rejects.toBeInstanceOf(RatchetPqDowngradeError);
    expect(sessions.has('bob|conv')).toBe(false);
  });

  it('(b) les deux pairs sans ML-KEM → comportement classique OK', async () => {
    const users = { alice: makeUser(false), bob: makeUser(false) };
    const { deps } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'classique');
    expect(msg.envelope.type).toBe('ratchet-init');
    expect(msg.envelope.pq).toBe(false);
    // Enveloppe sans PQ, MAIS aucune clé PQ locale → ce n'est PAS un downgrade.
    expect(() => assertPqNotDowngraded(users.bob.local, msg.envelope)).not.toThrow();

    expect(await decryptFromPeer(deps, 'bob', 'conv', msg.envelope, msg.content, 'alice')).toBe('classique');
  });

  it('(c) cas normal PQ (pq=true + ciphertext) → OK de bout en bout', async () => {
    const users = { alice: makeUser(true), bob: makeUser(true) };
    const { deps } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'pq-ok');
    expect(msg.envelope.pq).toBe(true);
    expect(msg.envelope.mlKemCiphertext).toBeTruthy();
    expect(lacksPqPart(msg.envelope)).toBe(false);

    expect(await decryptFromPeer(deps, 'bob', 'conv', msg.envelope, msg.content, 'alice')).toBe('pq-ok');
  });

  describe('garde-fou unitaire assertPqNotDowngraded', () => {
    const init: RatchetEnvelope = {
      type: 'ratchet-init',
      v: 1,
      header: { dh: 'a', pn: 0, n: 0 },
      iv: 'x',
    };

    it('refuse un init sans PQ quand une clé ML-KEM locale existe', () => {
      const local = makeUser(true).local;
      expect(() => assertPqNotDowngraded(local, init)).toThrow(RatchetPqDowngradeError);
    });

    it('laisse passer un init sans PQ quand AUCUNE clé ML-KEM locale n\'existe', () => {
      const local = makeUser(false).local;
      expect(() => assertPqNotDowngraded(local, init)).not.toThrow();
    });

    it('laisse passer les messages de ratchet post-init (non concernés par le PQ)', () => {
      const local = makeUser(true).local;
      const ratchet: RatchetEnvelope = { ...init, type: 'ratchet' };
      expect(lacksPqPart(ratchet)).toBe(false);
      expect(() => assertPqNotDowngraded(local, ratchet)).not.toThrow();
    });
  });
});
