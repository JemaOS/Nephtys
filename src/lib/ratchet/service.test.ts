import { describe, it, expect } from 'vitest';
import {
  generateIdentityKeyPair,
  generateSigningKeyPair,
  generateOneTimePreKeys,
  signPreKey,
  type SessionState,
} from './index';
import { generateX25519KeyPair } from './primitives';
import {
  encryptForPeer,
  decryptFromPeer,
  isRatchetEnvelope,
  type LocalRatchetKeys,
  type PeerBundle,
  type RatchetServiceDeps,
} from './service';

interface TestUser {
  local: LocalRatchetKeys;
  bundle: PeerBundle;
}

function makeUser(): TestUser {
  const identityKeyPair = generateIdentityKeyPair();
  const signingKeyPair = generateSigningKeyPair();
  const signedPreKey = generateX25519KeyPair();
  const opks = generateOneTimePreKeys(5);

  const oneTimePreKeys: Record<string, string> = {};
  for (const k of opks) oneTimePreKeys[k.publicKey] = k.privateKey;

  return {
    local: { identityKeyPair, signingKeyPair, signedPreKey, oneTimePreKeys },
    bundle: {
      identityKey: identityKeyPair.publicKey,
      signingKey: signingKeyPair.publicKey,
      signedPreKey: signedPreKey.publicKey,
      signedPreKeySignature: signPreKey(signingKeyPair.privateKey, signedPreKey.publicKey),
      oneTimePreKey: opks[0].publicKey,
    },
  };
}

/** Deps en mémoire partagées (simule IndexedDB + Supabase). */
function makeDeps(users: Record<string, TestUser>) {
  const sessions = new Map<string, SessionState>();
  const k = (u: string, p: string) => `${u}|${p}`;

  const deps: RatchetServiceDeps = {
    loadLocalKeys: async u => users[u]?.local ?? null,
    loadPeerBundle: async p => users[p]?.bundle ?? null,
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

describe('ratchet service (X3DH + Double Ratchet end-to-end)', () => {
  it('establishes a session on first send and decrypts on the peer', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);
    const bobOpk = users.bob.bundle.oneTimePreKey;

    const msg = await encryptForPeer(deps, 'alice', 'bob', 'bonjour');
    expect(msg.envelope.type).toBe('ratchet-init');
    expect(msg.envelope.identityKey).toBe(users.alice.local.identityKeyPair.publicKey);
    expect(msg.envelope.usedOneTimePreKey).toBe(bobOpk);
    expect(msg.content).not.toContain('bonjour');
    // La one-time prekey de Bob a bien été consommée.
    expect(users.bob.bundle.oneTimePreKey).toBeNull();

    const text = await decryptFromPeer(deps, 'bob', 'alice', msg.envelope, msg.content);
    expect(text).toBe('bonjour');
  });

  it('runs a bidirectional, multi-message conversation', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const a = async (t: string) => {
      const m = await encryptForPeer(deps, 'alice', 'bob', t);
      expect(await decryptFromPeer(deps, 'bob', 'alice', m.envelope, m.content)).toBe(t);
    };
    const b = async (t: string) => {
      const m = await encryptForPeer(deps, 'bob', 'alice', t);
      expect(await decryptFromPeer(deps, 'alice', 'bob', m.envelope, m.content)).toBe(t);
    };

    await a('a1'); // init
    await a('a2');
    await b('b1');
    await a('a3'); // ratchet DH après réponse
    await b('b2');
  });

  it('handles out-of-order delivery', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const init = await encryptForPeer(deps, 'alice', 'bob', 'init');
    await decryptFromPeer(deps, 'bob', 'alice', init.envelope, init.content);

    const m1 = await encryptForPeer(deps, 'alice', 'bob', 'm1');
    const m2 = await encryptForPeer(deps, 'alice', 'bob', 'm2');
    const m3 = await encryptForPeer(deps, 'alice', 'bob', 'm3');

    expect(await decryptFromPeer(deps, 'bob', 'alice', m3.envelope, m3.content)).toBe('m3');
    expect(await decryptFromPeer(deps, 'bob', 'alice', m1.envelope, m1.content)).toBe('m1');
    expect(await decryptFromPeer(deps, 'bob', 'alice', m2.envelope, m2.content)).toBe('m2');
  });

  it('rejects a tampered init (bad signature) and detects envelopes', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);
    users.bob.bundle.signedPreKeySignature = signPreKey(
      generateSigningKeyPair().privateKey,
      users.bob.bundle.signedPreKey,
    );

    await expect(encryptForPeer(deps, 'alice', 'bob', 'x')).rejects.toThrow(/signature/);

    expect(isRatchetEnvelope({ type: 'ratchet', header: { dh: 'a', pn: 0, n: 0 }, iv: 'x' })).toBe(true);
    expect(isRatchetEnvelope({ type: 'text', iv: 'x' })).toBe(false);
    expect(isRatchetEnvelope(null)).toBe(false);
  });
});
