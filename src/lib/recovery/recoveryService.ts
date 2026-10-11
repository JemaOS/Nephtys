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

/**
 * Installe les clés dérivées de la phrase : local + public uniquement.
 * Lève si la phrase est invalide.
 */
export async function installKeysFromPhrase(userId: string, phrase: string): Promise<void> {
  if (!validateRecoveryPhrase(phrase)) {
    throw new Error('Phrase de récupération invalide.');
  }
  const ratchet = await deriveLocalRatchetKeys(phrase);
  await installRatchetKeys(userId, ratchet);
  const x25519 = await deriveUserX25519KeyPair(phrase);
  await installX25519KeyPair(userId, x25519);
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
 * Régénère les clés (nouvelle phrase) : efface l'ancien matériel local/serveur
 * PUIS dérive + installe un nouveau jeu. Renvoie la nouvelle phrase.
 * ⚠️ L'historique chiffré avec l'ancienne phrase devient illisible.
 */
export async function regenerateRecoveryKeys(userId: string): Promise<string> {
  await clearLocalRatchetKeys(userId);
  await clearLocalX25519(userId);
  return setupRecoveryKeys(userId);
}
