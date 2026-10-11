// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Récupération par **phrase de récupération** (zéro stockage serveur).
 *
 * Modèle : toutes les clés privées sont **dérivées de façon déterministe** d'une
 * phrase BIP-39 (24 mots) que l'utilisateur conserve. Le serveur ne stocke
 * AUCUNE clé privée. Sur un nouvel appareil, la 1re connexion demande la phrase
 * → les mêmes clés sont reconstruites → l'historique redevient lisible.
 *
 * Dérivation :
 *   phrase ──BIP39──▶ seed (64 o) ──HKDF-SHA256(label)──▶ clé 32 o ──▶ keypair
 *   • X25519 user   (stack e2eeX25519)  label « x25519-user »
 *   • identité DH   (X3DH, X25519)      label « identity »
 *   • signature     (Ed25519)          label « signing »
 *   • signed prekey (X25519)           label « signed-prekey »
 *   • one-time prekeys (X25519)        label « opk-<i> »
 *   • ML-KEM-768                       label « mlkem » (keygen seedé)
 *
 * ⚠️ Toute modification des labels CASSE la récupération des comptes existants.
 */

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { bytesToBase64, hkdf, type RawKeyPair } from '../ratchet/primitives';
import { tagX25519 } from '../x25519';
import type { SigningKeyPair } from '../ratchet/x3dh';
import type { MlKemKeyPair } from '../ratchet/pqKem';
import type { LocalRatchetKeys } from '../ratchet/service';

const LABEL_PREFIX = 'nephtys-recovery-v1';
const DEFAULT_OPK_COUNT = 20;

/** Normalise une phrase saisie (casse, espaces). */
function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Génère une phrase de récupération neuve (24 mots, 256 bits d'entropie). */
export function generateRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

/** Vrai si la phrase est une phrase BIP-39 valide (checksum inclus). */
export function validateRecoveryPhrase(phrase: string): boolean {
  try {
    return validateMnemonic(normalizePhrase(phrase), wordlist);
  } catch {
    return false;
  }
}

/** Dérive le seed maître (64 octets) depuis la phrase. Rejette une phrase invalide. */
export function deriveMasterSeed(phrase: string): Uint8Array {
  if (!validateRecoveryPhrase(phrase)) {
    throw new Error('Phrase de récupération invalide.');
  }
  return mnemonicToSeedSync(normalizePhrase(phrase));
}

async function derive32(seed: Uint8Array, label: string): Promise<Uint8Array> {
  return hkdf(seed, new Uint8Array(0), `${LABEL_PREFIX}:${label}`, 32);
}

/** Paire X25519 déterministe. */
export async function deriveX25519KeyPair(seed: Uint8Array, label: string): Promise<RawKeyPair> {
  const priv = await derive32(seed, label);
  return { privateKey: bytesToBase64(priv), publicKey: bytesToBase64(x25519.getPublicKey(priv)) };
}

/** Paire Ed25519 déterministe (priv = seed 32 o). */
export async function deriveSigningKeyPair(seed: Uint8Array, label: string): Promise<SigningKeyPair> {
  const priv = await derive32(seed, label);
  return { privateKey: bytesToBase64(priv), publicKey: bytesToBase64(ed25519.getPublicKey(priv)) };
}

/** Paire ML-KEM-768 déterministe (keygen seedé). */
export async function deriveMlKemKeyPair(seed: Uint8Array, label: string): Promise<MlKemKeyPair> {
  const kseed = await hkdf(
    seed,
    new Uint8Array(0),
    `${LABEL_PREFIX}:${label}`,
    ml_kem768.lengths.seed,
  );
  const { publicKey, secretKey } = ml_kem768.keygen(kseed as Uint8Array);
  return { publicKey: bytesToBase64(publicKey), secretKey: bytesToBase64(secretKey) };
}

/** Clé X25519 « utilisateur » (pile e2eeX25519) déterministe (publique taguée). */
export async function deriveUserX25519KeyPair(phrase: string): Promise<RawKeyPair> {
  const seed = deriveMasterSeed(phrase);
  const pair = await deriveX25519KeyPair(seed, 'x25519-user');
  return { publicKey: tagX25519(pair.publicKey), privateKey: pair.privateKey };
}

/**
 * Dérive l'intégralité du matériel ratchet/X3DH (identité, signature, signed
 * prekey, one-time prekeys, ML-KEM) de la phrase.
 */
export async function deriveLocalRatchetKeys(
  phrase: string,
  opkCount = DEFAULT_OPK_COUNT,
): Promise<LocalRatchetKeys> {
  const seed = deriveMasterSeed(phrase);
  const identityKeyPair = await deriveX25519KeyPair(seed, 'identity');
  const signingKeyPair = await deriveSigningKeyPair(seed, 'signing');
  const signedPreKey = await deriveX25519KeyPair(seed, 'signed-prekey');

  const oneTimePreKeys: Record<string, string> = {};
  for (let i = 0; i < opkCount; i++) {
    const kp = await deriveX25519KeyPair(seed, `opk-${i}`);
    oneTimePreKeys[kp.publicKey] = kp.privateKey;
  }

  const mlKemKeyPair = await deriveMlKemKeyPair(seed, 'mlkem');
  return { identityKeyPair, signingKeyPair, signedPreKey, oneTimePreKeys, mlKemKeyPair };
}
