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
  const mlKemKeyPair = generateMlKemKeyPair();

  const oneTimePreKeys: Record<string, string> = {};
  for (const k of opks) oneTimePreKeys[k.publicKey] = k.privateKey;

  return {
    local: { identityKeyPair, signingKeyPair, signedPreKey, oneTimePreKeys, mlKemKeyPair },
    bundle: {
      identityKey: identityKeyPair.publicKey,
      signingKey: signingKeyPair.publicKey,
      signedPreKey: signedPreKey.publicKey,
      signedPreKeySignature: signPreKey(signingKeyPair.privateKey, signedPreKey.publicKey, mlKemKeyPair.publicKey),
      oneTimePreKey: opks[0].publicKey,
      mlKemPublicKey: mlKemKeyPair.publicKey,
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

describe('ratchet service (X3DH + Double Ratchet end-to-end)', () => {
  it('establishes a session on first send and decrypts on the peer', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);
    const bobOpk = users.bob.bundle.oneTimePreKey;

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'bonjour');
    expect(msg.envelope.type).toBe('ratchet-init');
    // Sealed sender : l'identité de l'expéditeur n'est PLUS dans l'enveloppe.
    expect(msg.envelope.identityKey).toBeUndefined();
    // One-time prekey utilisée (forward secrecy dès l'init).
    expect(msg.envelope.usedOneTimePreKey).toBe(bobOpk);
    expect(msg.content).not.toContain('bonjour');
    // La one-time prekey de Bob est marquée consommée.
    expect(users.bob.bundle.oneTimePreKey).toBeNull();

    // Le destinataire retrouve l'identité via `loadPeerIdentityKey(senderId)`.
    const text = await decryptFromPeer(deps, 'bob', 'conv', msg.envelope, msg.content, 'alice');
    expect(text).toBe('bonjour');
  });

  it('runs a bidirectional, multi-message conversation', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const a = async (t: string) => {
      const m = await encryptForPeer(deps, 'alice', 'conv', 'bob', t);
      expect(await decryptFromPeer(deps, 'bob', 'conv', m.envelope, m.content, 'alice')).toBe(t);
    };
    const b = async (t: string) => {
      const m = await encryptForPeer(deps, 'bob', 'conv', 'alice', t);
      expect(await decryptFromPeer(deps, 'alice', 'conv', m.envelope, m.content, 'bob')).toBe(t);
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

    const init = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'init');
    await decryptFromPeer(deps, 'bob', 'conv', init.envelope, init.content, 'alice');

    const m1 = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm1');
    const m2 = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm2');
    const m3 = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm3');

    expect(await decryptFromPeer(deps, 'bob', 'conv', m3.envelope, m3.content, 'alice')).toBe('m3');
    expect(await decryptFromPeer(deps, 'bob', 'conv', m1.envelope, m1.content, 'alice')).toBe('m1');
    expect(await decryptFromPeer(deps, 'bob', 'conv', m2.envelope, m2.content, 'alice')).toBe('m2');
  });

  it('round-trip avec hybride post-quantique (ML-KEM actif)', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const init = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'pq-bonjour');
    expect(init.envelope.type).toBe('ratchet-init');
    expect(init.envelope.pq).toBe(true);
    expect(init.envelope.mlKemCiphertext).toBeTruthy();
    expect(await decryptFromPeer(deps, 'bob', 'conv', init.envelope, init.content, 'alice')).toBe('pq-bonjour');
  });

  it('rejects a tampered init (bad signature) and detects envelopes', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);
    users.bob.bundle.signedPreKeySignature = signPreKey(
      generateSigningKeyPair().privateKey,
      users.bob.bundle.signedPreKey,
    );

    await expect(encryptForPeer(deps, 'alice', 'conv', 'bob', 'x')).rejects.toThrow(/signature/);

    expect(isRatchetEnvelope({ type: 'ratchet', header: { dh: 'a', pn: 0, n: 0 }, iv: 'x' })).toBe(true);
    expect(isRatchetEnvelope({ type: 'text', iv: 'x' })).toBe(false);
    expect(isRatchetEnvelope(null)).toBe(false);
  });

  it('rétrocompat : une enveloppe legacy portant identityKey se déchiffre sans lookup', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'legacy');
    // Ancien trafic : l'identité était stockée dans l'enveloppe. On la rajoute
    // et on NE fournit PAS de senderId → elle doit être utilisée.
    const legacyEnvelope = {
      ...msg.envelope,
      identityKey: users.alice.local.identityKeyPair.publicKey,
    };
    expect(await decryptFromPeer(deps, 'bob', 'conv', legacyEnvelope, msg.content)).toBe('legacy');
  });

  it('identité transportée (payload v3) : déchiffre sans lookup profil', async () => {
    const users = { alice: makeUser(), bob: makeUser() };
    const { deps } = makeDeps(users);

    const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'via-v3');
    // Expéditeur inconnu des deps, MAIS sa clé d'identité est fournie (résolue
    // par le sealed sender v3) → le déchiffrement doit aboutir.
    const text = await decryptFromPeer(
      deps,
      'bob',
      'conv',
      msg.envelope,
      msg.content,
      'sender-inconnu',
      users.alice.local.identityKeyPair.publicKey,
    );
    expect(text).toBe('via-v3');
  });
});
