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
import { supabase } from '../supabase';
import { isAtRestBox, openAtRest, sealAtRestStrict } from '../atRestCrypto';

export { generateRecoveryPhrase, validateRecoveryPhrase };

// ─── Lien d'appareil (multi-appareil façon WhatsApp) ──────────────────
// La phrase de récupération EST la clé maîtresse : la transmettre via QR
// (de proximité) lie un 2e appareil en lui donnant les mêmes clés.

const DEVICE_PREFIX = 'NEPHTYS-DEVICE:';
const PHRASE_KEY = 'nephtys_recovery_phrase';

/**
 * Mémorise la phrase localement — CHIFFRÉE au repos (AES-256-GCM, clé
 * non extractible). La phrase EST la clé maîtresse : elle n'est JAMAIS écrite
 * en clair. Si le chiffrement au repos est indisponible, on n'écrit rien
 * (aucun repli en clair) et on purge toute valeur existante.
 */
export async function storeRecoveryPhrase(phrase: string): Promise<void> {
  const normalized = phrase.trim();
  try {
    const box = await sealAtRestStrict(normalized);
    localStorage.setItem(PHRASE_KEY, JSON.stringify(box));
  } catch {
    // Chiffrement indisponible → ne jamais persister la clé maîtresse en clair.
    try {
      localStorage.removeItem(PHRASE_KEY);
    } catch {
      // localStorage indisponible
    }
  }
}

/**
 * Phrase mémorisée localement (chiffrée), ou null si absente/illisible.
 *
 * Migration : une ancienne valeur EN CLAIR (vulnérabilité) est purgée
 * immédiatement puis, au mieux, ré-écrite chiffrée. Aucune valeur en clair ne
 * subsiste après lecture.
 */
export async function getStoredRecoveryPhrase(): Promise<string | null> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(PHRASE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isAtRestBox(parsed)) {
      const value = await openAtRest(parsed);
      return typeof value === 'string' ? value : null;
    }
  } catch {
    // Pas du JSON → ancienne valeur en clair ci-dessous.
  }

  // Ancienne valeur en clair : purge immédiate, puis ré-écriture chiffrée
  // (best effort). La phrase est valide → on la renvoie à l'appelant.
  try {
    localStorage.removeItem(PHRASE_KEY);
  } catch {
    // ignore
  }
  const legacy = raw.trim();
  if (!validateRecoveryPhrase(legacy)) return null;
  await storeRecoveryPhrase(legacy);
  return legacy;
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
  await storeRecoveryPhrase(phrase);
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

// ─── Vérification du bundle dérivé vs clés publiées du compte ─────────

/** Bundle PUBLIC publié dans `profiles` (jamais de secret ici). */
export interface PublishedPublicBundle {
  ratchet_identity_key?: string | null;
  ratchet_signing_key?: string | null;
  ratchet_signed_prekey?: string | null;
  ml_kem_public_key?: string | null;
  x25519_public_key?: string | null;
}

/** Bundle PUBLIC dérivé d'une phrase (à comparer au serveur). */
export interface DerivedPublicBundle {
  identityKey: string;
  signingKey: string;
  signedPreKey: string;
  mlKemKey: string;
  x25519Key: string;
}

export interface PhraseAccountCheck {
  /** Au moins une clé publique est publiée pour le compte (comparable). */
  published: boolean;
  /** Aucun écart entre le bundle dérivé et les clés publiées. */
  matches: boolean;
  /** Champs en désaccord (diagnostic, jamais de secret). */
  mismatches: string[];
}

/**
 * Compare (PUR, sans réseau) le bundle dérivé d'une phrase aux clés publiques
 * publiées du compte. Un écart ⇒ la phrase n'est PAS celle du compte : un simple
 * porteur de session ne peut donc PAS substituer les clés en présentant une
 * phrase arbitraire.
 */
export function comparePublicBundles(
  published: PublishedPublicBundle,
  derived: DerivedPublicBundle,
): PhraseAccountCheck {
  const mismatches: string[] = [];
  let publishedAny = false;

  const compare = (field: string, remote: string | null | undefined, local: string): void => {
    if (!remote) return;
    publishedAny = true;
    if (remote !== local) mismatches.push(field);
  };

  compare('ratchet_identity_key', published.ratchet_identity_key, derived.identityKey);
  compare('ratchet_signing_key', published.ratchet_signing_key, derived.signingKey);
  compare('ratchet_signed_prekey', published.ratchet_signed_prekey, derived.signedPreKey);
  compare('ml_kem_public_key', published.ml_kem_public_key, derived.mlKemKey);
  compare('x25519_public_key', published.x25519_public_key, derived.x25519Key);

  return { published: publishedAny, matches: mismatches.length === 0, mismatches };
}

/** Dérive le bundle PUBLIC (aucune clé privée) d'une phrase. */
export async function derivePublicBundle(phrase: string): Promise<DerivedPublicBundle> {
  if (!validateRecoveryPhrase(phrase)) {
    throw new Error('Phrase de récupération invalide.');
  }
  const [ratchet, x25519] = await Promise.all([
    deriveLocalRatchetKeys(phrase),
    deriveUserX25519KeyPair(phrase),
  ]);
  return {
    identityKey: ratchet.identityKeyPair.publicKey,
    signingKey: ratchet.signingKeyPair.publicKey,
    signedPreKey: ratchet.signedPreKey.publicKey,
    mlKemKey: ratchet.mlKemKeyPair?.publicKey ?? '',
    x25519Key: x25519.publicKey,
  };
}

/**
 * Vérifie qu'une phrase correspond aux clés PUBLIQUES déjà publiées du compte,
 * AVANT toute (ré)installation. Empêche un porteur de session de substituer les
 * clés avec une phrase arbitraire (`completeRecovery`).
 *
 * Fail-closed : si le profil/clés sont illisibles alors qu'une vérification est
 * possible, on refuse (`matches=false`). Si le compte n'a AUCUNE clé publiée
 * (compte neuf), il n'y a rien à comparer → autorisé (`published=false`).
 */
export async function checkPhraseMatchesAccount(
  userId: string,
  phrase: string,
): Promise<PhraseAccountCheck> {
  if (!validateRecoveryPhrase(phrase)) {
    return { published: false, matches: false, mismatches: ['phrase-invalide'] };
  }
  const [derived, { data, error }] = await Promise.all([
    derivePublicBundle(phrase),
    supabase
      .from('profiles')
      .select('ratchet_identity_key, ratchet_signing_key, ratchet_signed_prekey, ml_kem_public_key, x25519_public_key')
      .eq('id', userId)
      .maybeSingle(),
  ]);
  if (error || !data) {
    // Clés illisibles : on ne peut PAS prouver l'identité → refus (fail-closed).
    return { published: true, matches: false, mismatches: ['profil-indisponible'] };
  }
  return comparePublicBundles(data as PublishedPublicBundle, derived);
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
