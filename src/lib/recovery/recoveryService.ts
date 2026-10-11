// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Service de récupération « zéro serveur ».
 *
 *   • À l'inscription : on génère une phrase, on dérive TOUTES les clés, on les
 *     stocke LOCALEMENT et on ne publie que le matériel PUBLIC. Rien de privé
 *     n'est envoyé au serveur.
 *   • Sur un nouvel appareil : l'app détecte l'absence de clés locales et
 *     demande la phrase → mêmes clés reconstruites → historique lisible.
 */

import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
  deriveLocalRatchetKeys,
  deriveUserX25519KeyPair,
} from './keysFromPhrase';
import { installRatchetKeys, getLocalRatchetKeys, clearLocalRatchetKeys } from '../ratchet/keyStore';
import { installX25519KeyPair, getLocalX25519KeyPair, clearLocalX25519 } from '../e2eeX25519';

export { generateRecoveryPhrase, validateRecoveryPhrase };

// ─── Lien d'appareil (multi-appareil façon WhatsApp) ──────────────────
// La phrase de récupération EST la clé maîtresse : la transmettre via QR
// (de proximité) lie un 2e appareil en lui donnant les mêmes clés.

const DEVICE_PREFIX = 'NEPHTYS-DEVICE:';
const PHRASE_KEY = 'nephtys_recovery_phrase';

/** Mémorise la phrase localement (pour pouvoir ré-afficher « mon code »). */
export function storeRecoveryPhrase(phrase: string): void {
  try {
    localStorage.setItem(PHRASE_KEY, phrase.trim());
  } catch {
    // localStorage indisponible
  }
}

/** Phrase mémorisée localement (ou null si absente). */
export function getStoredRecoveryPhrase(): string | null {
  try {
    return localStorage.getItem(PHRASE_KEY);
  } catch {
    return null;
  }
}

/** Encode la phrase en lien d'appareil (contenu du QR « mon code »). */
export function encodeDeviceLink(phrase: string): string {
  return DEVICE_PREFIX + phrase.trim();
}

/** Extrait la phrase d'un contenu de QR scanné (null si ce n'est pas un lien Nephtys). */
export function parseDeviceLink(scanned: string): string | null {
  const value = scanned.trim();
  const phrase = value.startsWith(DEVICE_PREFIX) ? value.slice(DEVICE_PREFIX.length).trim() : value;
  return validateRecoveryPhrase(phrase) ? phrase : null;
}

/**
 * Installe les clés dérivées de la phrase : local + public uniquement.
 * Lève si la phrase est invalide.
 */
export async function installKeysFromPhrase(userId: string, phrase: string): Promise<void> {
  if (!validateRecoveryPhrase(phrase)) {
    throw new Error('Phrase de récupération invalide.');
  }
  storeRecoveryPhrase(phrase);
  const ratchet = await deriveLocalRatchetKeys(phrase);
  await installRatchetKeys(userId, ratchet);
  const x25519 = await deriveUserX25519KeyPair(phrase);
  // On publie la signature Ed25519 de la clé X25519 (authentification anti-MITM).
  await installX25519KeyPair(userId, x25519, ratchet.signingKeyPair);
}

/**
 * Crée un nouveau jeu de clés : génère une phrase, dérive + installe les clés,
 * renvoie la phrase (à afficher à l'utilisateur pour sauvegarde).
 */
export async function setupRecoveryKeys(userId: string): Promise<string> {
  const phrase = generateRecoveryPhrase();
  await installKeysFromPhrase(userId, phrase);
  return phrase;
}

/** Vrai si l'appareil possède déjà des clés locales (ratchet + X25519). */
export async function hasLocalKeys(userId: string): Promise<boolean> {
  const [ratchet, x25519] = await Promise.all([
    getLocalRatchetKeys(userId),
    getLocalX25519KeyPair(userId),
  ]);
  return !!ratchet && !!x25519;
}

/**
 * Vérifie qu'une phrase fournie correspond bien au matériel DÉJÀ installé
 * localement — preuve de possession de l'ancienne phrase avant toute rotation.
 *
 * Compare la clé publique d'identité X25519 (X3DH) et la clé publique de
 * signature ratchet si disponible, ainsi que la clé publique X25519
 * « utilisateur » (pile e2eeX25519). Renvoie `false` si aucune clé locale
 * ne permet la vérification (aucune preuve ⇒ refus).
 */
export async function verifyCurrentPhrase(userId: string, phrase: string): Promise<boolean> {
  if (!validateRecoveryPhrase(phrase)) return false;

  const [ratchet, x25519, derivedRatchet, derivedX25519] = await Promise.all([
    getLocalRatchetKeys(userId),
    getLocalX25519KeyPair(userId),
    deriveLocalRatchetKeys(phrase),
    deriveUserX25519KeyPair(phrase),
  ]);

  let checked = false;

  const localIdentity = ratchet?.identityKeyPair?.publicKey;
  if (localIdentity) {
    if (localIdentity !== derivedRatchet.identityKeyPair.publicKey) return false;
    checked = true;
  }

  const localSigning = ratchet?.signingKeyPair?.publicKey;
  if (localSigning) {
    if (localSigning !== derivedRatchet.signingKeyPair.publicKey) return false;
    checked = true;
  }

  if (x25519?.publicKey) {
    if (x25519.publicKey !== derivedX25519.publicKey) return false;
    checked = true;
  }

  return checked;
}

/**
 * Régénère les clés (nouvelle phrase). Exige la PREUVE de l'ancienne phrase :
 * `currentPhrase` est vérifiée contre le matériel local AVANT toute
 * modification. Ensuite on efface l'ancien matériel local/serveur PUIS on
 * dérive + installe un nouveau jeu. Renvoie la nouvelle phrase.
 * ⚠️ L'historique chiffré avec l'ancienne phrase devient illisible.
 *
 * @throws si `currentPhrase` ne correspond pas aux clés installées.
 */
export async function regenerateRecoveryKeys(userId: string, currentPhrase: string): Promise<string> {
  const verified = await verifyCurrentPhrase(userId, currentPhrase);
  if (!verified) {
    throw new Error('Phrase de récupération actuelle incorrecte.');
  }
  await clearLocalRatchetKeys(userId);
  await clearLocalX25519(userId);
  return setupRecoveryKeys(userId);
}
