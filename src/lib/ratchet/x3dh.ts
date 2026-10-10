// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * X3DH (Extended Triple Diffie-Hellman) — établissement de session initiale.
 *
 * Modèle de clés par utilisateur :
 *   • identité DH   (X25519) : ik
 *   • clé de signature (Ed25519) : signe la « signed prekey » (anti-MITM)
 *   • signed prekey (X25519) : prekey moyen-terme, signée
 *   • one-time prekeys (X25519) : usage unique (forward secrecy à l'init)
 *
 * L'émetteur (initiateur) n'a besoin que du *bundle public* du destinataire.
 * Le secret partagé résultant alimente la root key du Double Ratchet.
 */

import { ed25519 } from '@noble/curves/ed25519.js';
import { mlKemEncapsulate, mlKemDecapsulate } from './pqKem';
import {
  base64ToBytes,
  bytesToBase64,
  concat,
  dh,
  generateX25519KeyPair,
  hkdf,
  randomBytes,
  type RawKeyPair,
} from './primitives';

export type IdentityKeyPair = RawKeyPair; // X25519
export interface SigningKeyPair { privateKey: string; publicKey: string; } // Ed25519 (priv = 32-byte seed)

/** Bundle public publié par un utilisateur pour être contacté. */
export interface PreKeyBundle {
  identityKey: string;            // X25519 pub
  signingKey: string;             // Ed25519 pub
  signedPreKey: string;           // X25519 pub
  signedPreKeySignature: string;  // Ed25519 signature (base64) sur signedPreKey
  oneTimePreKey?: string | null;  // X25519 pub (usage unique)
  /** Clé publique ML-KEM-768 (post-quantique). Optionnelle (rétro-compat). */
  mlKemPublicKey?: string | null;
}

export interface X3DHInitResult {
  rootKey: Uint8Array;
  associatedData: Uint8Array;
  /** Clé éphémère de l'initiateur = première clé de ratchet de l'initiateur. */
  ratchetKeyPair: RawKeyPair;
  /** À transmettre au destinataire dans le message initial. */
  ephemeralPublicKey: string;
  usedOneTimePreKey: string | null;
  /** Ciphertext ML-KEM à transmettre au destinataire (post-quantique). */
  mlKemCiphertext?: string | null;
}

export function generateIdentityKeyPair(): IdentityKeyPair {
  return generateX25519KeyPair();
}

export function generateSigningKeyPair(): SigningKeyPair {
  const seed = randomBytes(32);
  return { privateKey: bytesToBase64(seed), publicKey: bytesToBase64(ed25519.getPublicKey(seed)) };
}

export function generateOneTimePreKeys(count: number): RawKeyPair[] {
  return Array.from({ length: count }, () => generateX25519KeyPair());
}

/** Signe la signed prekey avec la clé de signature Ed25519. */
export function signPreKey(signingPrivateKeyB64: string, signedPreKeyB64: string): string {
  const signature = ed25519.sign(
    base64ToBytes(signedPreKeyB64),
    base64ToBytes(signingPrivateKeyB64),
  );
  return bytesToBase64(signature);
}

/** Vérifie la signature de la signed prekey (protège contre un MITM). */
export function verifyPreKey(bundle: PreKeyBundle): boolean {
  if (!bundle.signingKey || !bundle.signedPreKeySignature) return false;
  try {
    return ed25519.verify(
      base64ToBytes(bundle.signedPreKeySignature),
      base64ToBytes(bundle.signedPreKey),
      base64ToBytes(bundle.signingKey),
    );
  } catch {
    return false;
  }
}

function kdfInfo(): string {
  return 'NephtysX3DH';
}

function associatedData(initiatorIdentity: string, responderIdentity: string): Uint8Array {
  return concat(base64ToBytes(initiatorIdentity), base64ToBytes(responderIdentity));
}

/**
 * Côté initiateur : dérive le secret partagé depuis le bundle du destinataire.
 * Vérifie la signature de la signed prekey avant tout calcul.
 */
export async function x3dhInitiate(
  myIdentity: IdentityKeyPair,
  bundle: PreKeyBundle,
): Promise<X3DHInitResult> {
  if (!verifyPreKey(bundle)) {
    throw new Error('X3DH: signature de signed prekey invalide');
  }

  const ratchetKeyPair = generateX25519KeyPair();

  const dh1 = dh(myIdentity.privateKey, bundle.signedPreKey);
  const dh2 = dh(ratchetKeyPair.privateKey, bundle.identityKey);
  const dh3 = dh(ratchetKeyPair.privateKey, bundle.signedPreKey);
  const dh4 = bundle.oneTimePreKey
    ? dh(ratchetKeyPair.privateKey, bundle.oneTimePreKey)
    : new Uint8Array(0);

  // Hybride post-quantique : si le destinataire publie une clé ML-KEM, on
  // encapsule un secret supplémentaire (résistant au quantique).
  let mlKemCiphertext: string | null = null;
  let pqSecret = new Uint8Array(0);
  if (bundle.mlKemPublicKey) {
    const enc = mlKemEncapsulate(bundle.mlKemPublicKey);
    mlKemCiphertext = enc.cipherText;
    pqSecret = base64ToBytes(enc.sharedSecret);
  }

  const rootKey = await hkdf(
    concat(dh1, dh2, dh3, dh4, pqSecret),
    new Uint8Array(32),
    kdfInfo(),
    32,
  );

  return {
    rootKey,
    associatedData: associatedData(myIdentity.publicKey, bundle.identityKey),
    ratchetKeyPair,
    ephemeralPublicKey: ratchetKeyPair.publicKey,
    usedOneTimePreKey: bundle.oneTimePreKey ?? null,
    mlKemCiphertext,
  };
}

/**
 * Côté destinataire : recalcule le même secret partagé à partir de ses clés
 * privées et des éléments publics transmis par l'initiateur.
 */
export async function x3dhRespond(
  myIdentity: IdentityKeyPair,
  mySignedPreKey: RawKeyPair,
  myOneTimePreKey: RawKeyPair | null,
  initiatorIdentityKey: string,
  initiatorEphemeralKey: string,
  initiatorMlKemCiphertext: string | null = null,
  myMlKemSecretKey: string | null = null,
): Promise<{ rootKey: Uint8Array; associatedData: Uint8Array }> {
  const dh1 = dh(mySignedPreKey.privateKey, initiatorIdentityKey);
  const dh2 = dh(myIdentity.privateKey, initiatorEphemeralKey);
  const dh3 = dh(mySignedPreKey.privateKey, initiatorEphemeralKey);
  const dh4 = myOneTimePreKey
    ? dh(myOneTimePreKey.privateKey, initiatorEphemeralKey)
    : new Uint8Array(0);

  // Hybride post-quantique (miroir exact de l'initiateur).
  let pqSecret = new Uint8Array(0);
  if (initiatorMlKemCiphertext && myMlKemSecretKey) {
    pqSecret = base64ToBytes(mlKemDecapsulate(initiatorMlKemCiphertext, myMlKemSecretKey));
  }

  const rootKey = await hkdf(
    concat(dh1, dh2, dh3, dh4, pqSecret),
    new Uint8Array(32),
    kdfInfo(),
    32,
  );

  return {
    rootKey,
    associatedData: associatedData(initiatorIdentityKey, myIdentity.publicKey),
  };
}
