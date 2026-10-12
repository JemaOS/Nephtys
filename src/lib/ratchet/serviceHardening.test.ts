// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Durcissement du service ratchet :
 *  1. downgrade PQ **côté émetteur** (pair épinglé qui perd sa clé ML-KEM) —
 *     détection + signal, jamais de repli silencieux ;
 *  3. reconstruction de session **conditionnelle** — jamais d'écrasement d'une
 *     session valide sur simple échec AEAD, et init bornés (rate-limit).
 */

import { describe, it, expect, beforeEach } from 'vitest';
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
  resetInitRebuildRateLimit,
  onRatchetSecurityEvent,
  RatchetPqDowngradeError,
  RatchetPqSenderDowngradeError,
  type LocalRatchetKeys,
  type PeerBundle,
  type RatchetEnvelope,
  type RatchetSecurityEvent,
  type RatchetServiceDeps,
} from './service';

interface TestUser {
  local: LocalRatchetKeys;
  bundle: PeerBundle;
}

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

/** Deps en mémoire avec épinglage PQ + compteur de chargements de clés locales. */
function makeDeps(users: Record<string, TestUser>) {
  const sessions = new Map<string, SessionState>();
  const pins = new Set<string>();
  const k = (u: string, p: string) => `${u}|${p}`;
  let localKeyLoads = 0;

  const deps: RatchetServiceDeps = {
    loadLocalKeys: async u => {
      localKeyLoads++;
      return users[u]?.local ?? null;
    },
    loadPeerBundle: async p => users[p]?.bundle ?? null,
    loadPeerIdentityKey: async p => users[p]?.bundle.identityKey ?? null,
    markOneTimePreKeyUsed: async p => {
      if (users[p]) users[p].bundle.oneTimePreKey = null;
    },
    loadSession: async (u, p) => sessions.get(k(u, p)) ?? null,
    saveSession: async (u, p, s) => {
      sessions.set(k(u, p), s);
    },
    pinPeerPq: async (u, p) => {
      pins.add(k(u, p));
    },
    isPeerPqPinned: async (u, p) => pins.has(k(u, p)),
  };
  return {
    deps,
    sessions,
    pins,
    localKeyLoads: () => localKeyLoads,
    resetLoads: () => {
      localKeyLoads = 0;
    },
  };
}

function captureEvents(): { events: RatchetSecurityEvent[]; off: () => void } {
  const events: RatchetSecurityEvent[] = [];
  const off = onRatchetSecurityEvent(e => events.push(e));
  return { events, off };
}

beforeEach(() => resetInitRebuildRateLimit());

describe('1. downgrade PQ côté émetteur', () => {
  it("refuse un init vers un pair épinglé PQ dont le bundle a « perdu » sa clé ML-KEM", async () => {
    const { events, off } = captureEvents();
    try {
      const users = { alice: makeUser(true), bob: makeUser(true) };
      const { deps, pins } = makeDeps(users);

      // 1re session : Bob publie une clé ML-KEM → le pair est épinglé.
      await encryptForPeer(deps, 'alice', 'conv1', 'bob', 'a1');
      expect(pins.has('alice|bob')).toBe(true);

      // Bob « perd » sa clé PQ : bundle re-signé sur la signedPreKey seule
      // (donc `verifyPreKey` passe) mais plus de clé ML-KEM.
      users.bob.bundle.mlKemPublicKey = null;
      users.bob.bundle.signedPreKeySignature = signPreKey(
        users.bob.local.signingKeyPair.privateKey,
        users.bob.bundle.signedPreKey,
      );

      // Nouvelle session → nouvelle initiation → doit ÉCHOUER (fail-closed).
      await expect(
        encryptForPeer(deps, 'alice', 'conv2', 'bob', 'a2'),
      ).rejects.toBeInstanceOf(RatchetPqSenderDowngradeError);

      // L'erreur reste un `RatchetPqDowngradeError` (surface publique unifiée).
      await expect(
        encryptForPeer(deps, 'alice', 'conv3', 'bob', 'a3'),
      ).rejects.toBeInstanceOf(RatchetPqDowngradeError);

      // Un signal de sécurité a été émis (jamais de repli silencieux).
      expect(
        events.some(e => e.type === 'pq-downgrade-send' && e.peerId === 'bob'),
      ).toBe(true);
    } finally {
      off();
    }
  });

  it('pair sans PQ (nous PQ-capable) : signal informatif, pas d\'échec', async () => {
    const { events, off } = captureEvents();
    try {
      const users = { alice: makeUser(true), bob: makeUser(false) };
      const { deps } = makeDeps(users);

      const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'hi');
      expect(msg.envelope.pq).toBe(false);
      expect(events.some(e => e.type === 'pq-unavailable-send')).toBe(true);
      expect(events.some(e => e.type === 'pq-downgrade-send')).toBe(false);
      expect(
        await decryptFromPeer(deps, 'bob', 'conv', msg.envelope, msg.content, 'alice'),
      ).toBe('hi');
    } finally {
      off();
    }
  });

  it('pair PQ normal : épinglé, aucun signal de downgrade', async () => {
    const { events, off } = captureEvents();
    try {
      const users = { alice: makeUser(true), bob: makeUser(true) };
      const { deps, pins } = makeDeps(users);
      const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'pq');
      expect(msg.envelope.pq).toBe(true);
      expect(pins.has('alice|bob')).toBe(true);
      expect(events.some(e => e.type.startsWith('pq-downgrade'))).toBe(false);
    } finally {
      off();
    }
  });
});

describe('1b. signal de downgrade à la réception', () => {
  it('émet pq-downgrade-receive sur un init strippé de sa partie PQ', async () => {
    const { events, off } = captureEvents();
    try {
      const users = { alice: makeUser(true), bob: makeUser(true) };
      const { deps } = makeDeps(users);
      const msg = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'x');
      const stripped: RatchetEnvelope = { ...msg.envelope, pq: false, mlKemCiphertext: null };
      await expect(
        decryptFromPeer(deps, 'bob', 'conv', stripped, msg.content, 'alice'),
      ).rejects.toBeInstanceOf(RatchetPqDowngradeError);
      expect(events.some(e => e.type === 'pq-downgrade-receive')).toBe(true);
    } finally {
      off();
    }
  });
});

describe('3. reconstruction de session conditionnelle', () => {
  function tamperB64(b64: string): string {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    bytes[0] ^= 0xff;
    let out = '';
    for (const b of bytes) out += String.fromCharCode(b);
    return btoa(out);
  }

  it("n'écrase pas une session valide sur échec AEAD d'un ratchet-init", async () => {
    const users = { alice: makeUser(true), bob: makeUser(true) };
    const { deps, sessions } = makeDeps(users);

    const init = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'init');
    expect(
      await decryptFromPeer(deps, 'bob', 'conv', init.envelope, init.content, 'alice'),
    ).toBe('init');

    const before = JSON.stringify(sessions.get('bob|conv'));

    // Rejeu de l'init avec ciphertext altéré (même clé de ratchet → PAS de
    // re-init détecté). L'ancien code reconstruisait et écrasait la session.
    await expect(
      decryptFromPeer(deps, 'bob', 'conv', init.envelope, tamperB64(init.content), 'alice'),
    ).rejects.toBeTruthy();

    // La session stockée est INTACTE (pas d'écrasement sur échec AEAD).
    expect(JSON.stringify(sessions.get('bob|conv'))).toBe(before);
  });

  it('ré-initialisation légitime (nouvelle clé de ratchet) : reconstruction autorisée', async () => {
    const users = { alice: makeUser(true), bob: makeUser(true) };
    const { deps, sessions } = makeDeps(users);

    const init1 = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm1');
    await decryptFromPeer(deps, 'bob', 'conv', init1.envelope, init1.content, 'alice');

    // Alice perd sa session (nouvel appareil / reset) → ré-initialise.
    sessions.delete('alice|conv');
    const init2 = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm2');

    expect(init2.envelope.type).toBe('ratchet-init');
    expect(init2.envelope.ephemeralPublicKey).not.toBe(init1.envelope.ephemeralPublicKey);
    expect(
      await decryptFromPeer(deps, 'bob', 'conv', init2.envelope, init2.content, 'alice'),
    ).toBe('m2');
  });

  it('borne le nombre de reconstructions déclenchées par des init forgés (rate-limit)', async () => {
    const users = { alice: makeUser(false), bob: makeUser(false) };
    const { deps, resetLoads, localKeyLoads } = makeDeps(users);

    const init = await encryptForPeer(deps, 'alice', 'conv', 'bob', 'm1');
    await decryptFromPeer(deps, 'bob', 'conv', init.envelope, init.content, 'alice');
    resetLoads();

    const now = () => 1_000_000;
    for (let i = 0; i < 6; i++) {
      const forged: RatchetEnvelope = {
        type: 'ratchet-init',
        v: 1,
        header: { dh: generateX25519KeyPair().publicKey, pn: 0, n: 0 },
        iv: init.envelope.iv,
        identityKey: users.alice.local.identityKeyPair.publicKey,
        ephemeralPublicKey: generateX25519KeyPair().publicKey,
        usedOneTimePreKey: null,
        mlKemCiphertext: null,
        pq: false,
      };
      await expect(
        decryptFromPeer(deps, 'bob', 'conv', forged, init.content, 'alice', null, { now }),
      ).rejects.toBeTruthy();
    }

    // 6 init forgés → au plus INIT_REBUILD_MAX (4) reconstructions autorisées.
    expect(localKeyLoads()).toBe(4);
  });
});
