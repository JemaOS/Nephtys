// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Service de session E2EE à forward secrecy (X3DH + Double Ratchet).
 *
 * Au-dessus du moteur `doubleRatchet`/`x3dh`, ce service gère le cycle de vie
 * d'une session par pair (conversation directe) :
 *   • première émission → handshake X3DH (message `ratchet-init`) ;
 *   • messages suivants → messages de ratchet purs (`ratchet`) ;
 *   • à la réception, la session est reconstruite à partir de l'init, puis
 *     avancée message par message.
 *
 * Les dépendances (clés locales, bundle du pair, stockage de session) sont
 * **injectées** → testable de bout en bout en mémoire, et branchable sur
 * IndexedDB/Supabase en production (cf. `keyStore`/`sessionStore`).
 *
 * Le clair n'est jamais stocké : seul le couple (content=ciphertext,
 * encryption_metadata=enveloppe) circule et est persisté.
 */

import {
  initReceiverSession,
  initSenderSession,
  ratchetDecrypt,
  ratchetEncrypt,
  x3dhInitiate,
  x3dhRespond,
  generateIdentityKeyPair,
  generateSigningKeyPair,
  generateOneTimePreKeys,
  type PreKeyBundle,
  type RatchetHeader,
  type SessionState,
  type IdentityKeyPair,
  type RawKeyPair,
  type SigningKeyPair,
} from './index';
import { generateX25519KeyPair } from './primitives';
import { generateMlKemKeyPair, type MlKemKeyPair } from './pqKem';

/** Bundle public d'un pair (avec une one-time prekey disponible). */
export interface PeerBundle {
  identityKey: string;
  signingKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  oneTimePreKey: string | null;
  /** Clé publique ML-KEM-768 (post-quantique). Optionnelle (rétro-compat). */
  mlKemPublicKey?: string | null;
}

/** Matériel local (privé) d'un utilisateur. */
export interface LocalRatchetKeys {
  identityKeyPair: IdentityKeyPair;
  signingKeyPair: SigningKeyPair;
  signedPreKey: RawKeyPair;
  /** one-time prekeys encore disponibles : public → privé. */
  oneTimePreKeys: Record<string, string>;
  /** Clé ML-KEM (post-quantique). Optionnelle (comptes pré-PQ). */
  mlKemKeyPair?: MlKemKeyPair;
}

export interface RatchetServiceDeps {
  loadLocalKeys(userId: string): Promise<LocalRatchetKeys | null>;
  loadPeerBundle(peerId: string): Promise<PeerBundle | null>;
  markOneTimePreKeyUsed(peerId: string, oneTimePreKey: string): Promise<void>;
  loadSession(userId: string, peerId: string): Promise<SessionState | null>;
  saveSession(userId: string, peerId: string, state: SessionState): Promise<void>;
}

/**
 * Génère un jeu de clés ratchet LOCAL (non lié à un compte serveur).
 * Utilisé par le mode privé anonyme : chaque connexion a ses propres clés,
 * éphémères, échangées via un lien hors-bande.
 */
export function generateLocalRatchetKeys(oneTimePreKeyCount = 20): LocalRatchetKeys {
  const identityKeyPair = generateIdentityKeyPair();
  const signingKeyPair = generateSigningKeyPair();
  const signedPreKey = generateX25519KeyPair();
  const oneTimePreKeys: Record<string, string> = {};
  for (const k of generateOneTimePreKeys(oneTimePreKeyCount)) {
    oneTimePreKeys[k.publicKey] = k.privateKey;
  }
  return { identityKeyPair, signingKeyPair, signedPreKey, oneTimePreKeys, mlKemKeyPair: generateMlKemKeyPair() };
}
/** Enveloppe rangée dans `messages.encryption_metadata`. */
export interface RatchetEnvelope {
  type: 'ratchet-init' | 'ratchet';
  v: 1;
  header: RatchetHeader;
  iv: string;
  /** Présents uniquement pour `ratchet-init`. */
  identityKey?: string;
  ephemeralPublicKey?: string;
  usedOneTimePreKey?: string | null;
  /** Ciphertext ML-KEM (post-quantique), présent pour `ratchet-init`. */
  mlKemCiphertext?: string | null;
}

export interface EncryptedRatchetMessage {
  content: string;
  envelope: RatchetEnvelope;
}

function toBundle(bundle: PeerBundle): PreKeyBundle {
  return {
    identityKey: bundle.identityKey,
    signingKey: bundle.signingKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    oneTimePreKey: bundle.oneTimePreKey,
    mlKemPublicKey: bundle.mlKemPublicKey ?? null,
  };
}

/**
 * Chiffre un texte pour un pair : établit la session (X3DH) si nécessaire,
 * puis produit un message de ratchet. Persiste l'état avancé.
 */
export async function encryptForPeer(
  deps: RatchetServiceDeps,
  userId: string,
  sessionId: string,
  peerId: string,
  plaintext: string,
): Promise<EncryptedRatchetMessage> {
  let session = await deps.loadSession(userId, sessionId);
  let initFields: Pick<RatchetEnvelope, 'identityKey' | 'ephemeralPublicKey' | 'usedOneTimePreKey' | 'mlKemCiphertext'> | null = null;

  if (!session) {
    const localKeys = await deps.loadLocalKeys(userId);
    if (!localKeys) throw new Error('Ratchet: clés locales absentes (utilisateur non initialisé)');
    const bundle = await deps.loadPeerBundle(peerId);
    if (!bundle) throw new Error('Ratchet: bundle du pair indisponible');

    // Fiabilité : on n'utilise PAS de one-time prekey à l'init (source des
    // échecs « one-time prekey indisponible »). X3DH reste valide sans OPK ;
    // la forward secrecy est ensuite assurée par le Double Ratchet.
    const init = await x3dhInitiate(localKeys.identityKeyPair, { ...toBundle(bundle), oneTimePreKey: null, mlKemPublicKey: null });
    session = await initSenderSession(
      init.rootKey,
      bundle.signedPreKey,
      init.associatedData,
      init.ratchetKeyPair,
    );
    // Capturer AVANT de marquer consommée (l'objet bundle peut être muté).
    const usedOneTimePreKey: string | null = null;
    if (usedOneTimePreKey) {
      await deps.markOneTimePreKeyUsed(peerId, usedOneTimePreKey);
    }
    initFields = {
      identityKey: localKeys.identityKeyPair.publicKey,
      ephemeralPublicKey: init.ephemeralPublicKey,
      usedOneTimePreKey,
      mlKemCiphertext: init.mlKemCiphertext ?? null,
    };
  }

  const message = await ratchetEncrypt(session, plaintext);
  await deps.saveSession(userId, sessionId, session);

  const envelope: RatchetEnvelope = {
    type: initFields ? 'ratchet-init' : 'ratchet',
    v: 1,
    header: message.header,
    iv: message.ivB64,
    ...(initFields ?? {}),
  };
  return { content: message.ctB64, envelope };
}

/**
 * Déchiffre un message de ratchet reçu. Si c'est un `ratchet-init` et qu'aucune
 * session n'existe, la session destinataire est créée via X3DH.
 */
export async function decryptFromPeer(
  deps: RatchetServiceDeps,
  userId: string,
  sessionId: string,
  envelope: RatchetEnvelope,
  content: string,
): Promise<string> {
  const buildReceiverSession = async (): Promise<SessionState | null> => {
    const localKeys = await deps.loadLocalKeys(userId);
    if (!localKeys) return null;
    if (!envelope.identityKey || !envelope.ephemeralPublicKey) return null;

    const oneTimePreKeyPublic = envelope.usedOneTimePreKey ?? null;
    let oneTimePreKey: RawKeyPair | null = null;
    if (oneTimePreKeyPublic) {
      const priv = localKeys.oneTimePreKeys[oneTimePreKeyPublic];
      if (priv) oneTimePreKey = { privateKey: priv, publicKey: oneTimePreKeyPublic };
    }

    const resp = await x3dhRespond(
      localKeys.identityKeyPair,
      localKeys.signedPreKey,
      oneTimePreKey,
      envelope.identityKey,
      envelope.ephemeralPublicKey,
      null, // ML-KEM désactivé (source d'OperationError) — X3DH classique + Double Ratchet
      null,
    );
    return initReceiverSession(resp.rootKey, localKeys.signedPreKey, resp.associatedData);
  };

  let session = await deps.loadSession(userId, sessionId);

  // (Re)construit la session destinaire depuis l'init si absente OU si l'init
  // annonce une clé de ratchet différente de la session stockée (périmée).
  if (envelope.type === 'ratchet-init') {
    const stale = !!session && session.remoteRatchetPublicKey && session.remoteRatchetPublicKey !== envelope.ephemeralPublicKey;
    if (!session || stale) {
      const fresh = await buildReceiverSession();
      if (fresh) session = fresh;
    }
  }

  if (!session) {
    throw new Error('Ratchet: aucune session pour ce message');
  }

  try {
    const text = await ratchetDecrypt(session, {
      header: envelope.header,
      ivB64: envelope.iv,
      ctB64: content,
    });
    await deps.saveSession(userId, sessionId, session);
    return text;
  } catch (e) {
    // Sécurité fiabilité : si le déchiffrement échoue (session périmée /
    // divergente) ET qu'un `ratchet-init` est fourni, on reconstruit la
    // session depuis zéro (X3DH déterministe) et on réessaie une fois.
    if (envelope.type === 'ratchet-init') {
      const fresh = await buildReceiverSession();
      if (fresh) {
        const text = await ratchetDecrypt(fresh, {
          header: envelope.header,
          ivB64: envelope.iv,
          ctB64: content,
        });
        await deps.saveSession(userId, sessionId, fresh);
        return text;
      }
    }
    throw e;
  }
}

/** Indique si une enveloppe décrit un message de ratchet géré ici. */
function isRatchetObj(m: unknown): boolean {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (o.type === 'ratchet' || o.type === 'ratchet-init') && !!o.header && typeof o.iv === 'string';
}

export function isRatchetEnvelope(metadata: unknown): metadata is RatchetEnvelope {
  if (!metadata || typeof metadata !== 'object') return false;
  const m = metadata as Record<string, unknown>;
  // Format direct (legacy) OU format imbriqué dans `encryption_metadata.ratchet`
  // (double chiffrement : X25519 primaire + ratchet en surcouche).
  return isRatchetObj(m) || isRatchetObj(m.ratchet);
}
