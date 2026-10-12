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
  PqDowngradeError,
  PqSenderDowngradeError,
  type PreKeyBundle,
  type RatchetHeader,
  type SessionState,
  type IdentityKeyPair,
  type RawKeyPair,
  type SigningKeyPair,
} from './index';
import { generateX25519KeyPair } from './primitives';
import { generateMlKemKeyPair, type MlKemKeyPair } from './pqKem';

/**
 * Erreurs de downgrade post-quantique, ré-exportées depuis `x3dh` pour rester
 * la surface publique du service (`RatchetPqDowngradeError` couvre les deux
 * sens : `instanceof` attrape aussi `RatchetPqSenderDowngradeError`).
 */
export {
  PqDowngradeError as RatchetPqDowngradeError,
  PqSenderDowngradeError as RatchetPqSenderDowngradeError,
} from './x3dh';

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
  /**
   * Clé publique d'identité ratchet (X3DH) d'un pair, SANS consommer de
   * one-time prekey (contrairement à `loadPeerBundle`). Utilisée à la réception
   * pour retrouver l'identité de l'initiateur quand elle n'est plus stockée en
   * clair dans l'enveloppe (sealed sender).
   */
  loadPeerIdentityKey(peerId: string): Promise<string | null>;
  markOneTimePreKeyUsed(peerId: string, oneTimePreKey: string): Promise<void>;
  loadSession(userId: string, peerId: string): Promise<SessionState | null>;
  saveSession(userId: string, peerId: string, state: SessionState): Promise<void>;
  /**
   * Épingle (« ce contact a publié une clé PQ ») : mémorise qu'un pair était
   * PQ-capable, pour détecter qu'il « perd » ensuite sa clé ML-KEM (downgrade
   * à l'émission). Optionnel : sans ces hooks, la détection par épinglage est
   * simplement inactive (rétrocompat tests / intégrations).
   */
  pinPeerPq?(userId: string, peerId: string): Promise<void>;
  isPeerPqPinned?(userId: string, peerId: string): Promise<boolean>;
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
  /** Vrai si l'init a utilisé le hybride post-quantique (ML-KEM). */
  pq?: boolean;
}

export interface EncryptedRatchetMessage {
  content: string;
  envelope: RatchetEnvelope;
}

// ─── Anti-downgrade post-quantique (ML-KEM) ────────────────────────────

/**
 * Garde-fou **réception** : `RatchetPqDowngradeError` (alias de `PqDowngradeError`)
 * est levée quand un `ratchet-init` reçu tente de faire retomber une session en
 * mode X3DH **classique** (non PQ) alors que notre clé ML-KEM est publiée.
 *
 * Modèle de menace : un serveur ou un MITM peut retirer la partie post-quantique
 * d'une enveloppe (`pq` / `mlKemCiphertext`) pour « éteindre » silencieusement
 * la protection ML-KEM. Sans garde-fou, la session s'établissait en mode dégradé
 * sans que personne ne s'en aperçoive.
 *
 * Invariant exploité : l'encapsulation ML-KEM cible TOUJOURS la clé publique du
 * **destinataire** (`bundle.mlKemPublicKey` → `x3dhInitiate`). Donc si NOUS avons
 * publié une clé ML-KEM (`localKeys.mlKemKeyPair`, cf. `keyStore.publishKeys`),
 * tout initiateur conforme DOIT inclure la partie PQ. Une enveloppe
 * `ratchet-init` sans PQ dans ce cas est anormale → on REFUSE (fail-closed)
 * plutôt que d'établir une session en downgrade silencieux.
 *
 * Côté ÉMETTEUR, c'est `RatchetPqSenderDowngradeError` (sous-classe) qui couvre
 * le cas symétrique : le pair épinglé ne publie plus de clé ML-KEM
 * (cf. `pinPeerPq` / `x3dhInitiate({ requireMlKem })`).
 */

// ─── Signalement de sécurité (downgrade PQ) ────────────────────────────

export type RatchetSecurityEventType =
  | 'pq-downgrade-send'
  | 'pq-downgrade-receive'
  | 'pq-unavailable-send';

export interface RatchetSecurityEvent {
  type: RatchetSecurityEventType;
  userId: string;
  peerId: string;
  message: string;
}

type RatchetSecurityListener = (event: RatchetSecurityEvent) => void;
const securityListeners = new Set<RatchetSecurityListener>();

/**
 * Abonne un écouteur aux signaux de sécurité ratchet (downgrade PQ…).
 * Retourne une fonction de désabonnement. Les erreurs d'un écouteur ne doivent
 * jamais interrompre la crypto → elles sont avalées.
 */
export function onRatchetSecurityEvent(listener: RatchetSecurityListener): () => void {
  securityListeners.add(listener);
  return () => securityListeners.delete(listener);
}

/** Émet un signal de sécurité (observable, jamais bloquant). */
export function emitRatchetSecurityEvent(event: RatchetSecurityEvent): void {
  for (const listener of securityListeners) {
    try {
      listener(event);
    } catch {
      // un écouteur défaillant ne casse pas le chemin cryptographique
    }
  }
}

/**
 * Vrai si l'enveloppe est un `ratchet-init` qui ne porte PAS de partie PQ
 * exploitable (flag `pq` absent/faux OU ciphertext ML-KEM manquant).
 */
export function lacksPqPart(envelope: RatchetEnvelope): boolean {
  return envelope.type === 'ratchet-init' && !(envelope.pq === true && !!envelope.mlKemCiphertext);
}

/**
 * Fail-closed anti-downgrade : refuse un `ratchet-init` dépourvu de partie PQ
 * lorsque nous avons publié une clé ML-KEM. Voir `RatchetPqDowngradeError`.
 * Sans clé ML-KEM locale (comptes pré-PQ / pairs classiques), laisse passer.
 */
export function assertPqNotDowngraded(
  localKeys: LocalRatchetKeys | null,
  envelope: RatchetEnvelope,
): void {
  if (localKeys?.mlKemKeyPair && lacksPqPart(envelope)) {
    throw new PqDowngradeError(
      'Ratchet: downgrade post-quantique détecté (ratchet-init sans ML-KEM alors que la clé PQ est publiée)',
    );
  }
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
  let initFields: Pick<RatchetEnvelope, 'identityKey' | 'ephemeralPublicKey' | 'usedOneTimePreKey' | 'mlKemCiphertext' | 'pq'> | null = null;

  if (!session) {
    const localKeys = await deps.loadLocalKeys(userId);
    if (!localKeys) throw new Error('Ratchet: clés locales absentes (utilisateur non initialisé)');
    const bundle = await deps.loadPeerBundle(peerId);
    if (!bundle) throw new Error('Ratchet: bundle du pair indisponible');

    // ── Anti-downgrade post-quantique côté ÉMETTEUR ──────────────────────
    // Si le pair est épinglé comme PQ-capable (il publiait une clé ML-KEM) mais
    // que son bundle n'en porte PLUS, on REFUSE l'initiation classique (via
    // `requireMlKem` → `x3dhInitiate`) au lieu de retomber silencieusement en
    // X25519 (perte de la protection PQ). On SIGNALE aussi le downgrade.
    const peerHasPq = !!bundle.mlKemPublicKey;
    const pinnedPq = deps.isPeerPqPinned ? await deps.isPeerPqPinned(userId, peerId) : false;

    if (!peerHasPq && !pinnedPq && localKeys.mlKemKeyPair) {
      // Nous sommes PQ-capable mais le pair ne l'est pas : signal informatif
      // (pas d'échec) — la session reste classique, mais plus silencieuse.
      emitRatchetSecurityEvent({
        type: 'pq-unavailable-send',
        userId,
        peerId,
        message: 'Ratchet: pair sans clé ML-KEM, session établie sans protection post-quantique',
      });
    }

    // Épingle le pair dès qu'on observe une clé ML-KEM (pour détecter plus tard
    // qu'il « perd » sa capacité PQ).
    if (peerHasPq && deps.pinPeerPq) {
      await deps.pinPeerPq(userId, peerId);
    }

    // One-time prekey : si le pair en publie une, on l'utilise (forward secrecy
    // dès l'init, comme Signal). Sinon le chemin reste valide sans OPK.
    // Capturer AVANT de marquer consommée (l'objet bundle peut être muté).
    const usedOneTimePreKey: string | null = bundle.oneTimePreKey ?? null;
    // Hybride post-quantique : si le pair publie une clé ML-KEM (dont la
    // signature couvre la clé), on l'utilise. Sinon, chemin X3DH classique —
    // MAIS fail-closed si le pair était épinglé PQ (`requireMlKem`).
    let init;
    try {
      init = await x3dhInitiate(
        localKeys.identityKeyPair,
        { ...toBundle(bundle), oneTimePreKey: usedOneTimePreKey },
        { requireMlKem: pinnedPq },
      );
    } catch (e) {
      if (e instanceof PqSenderDowngradeError) {
        emitRatchetSecurityEvent({ type: 'pq-downgrade-send', userId, peerId, message: e.message });
      }
      throw e;
    }
    session = await initSenderSession(
      init.rootKey,
      bundle.signedPreKey,
      init.associatedData,
      init.ratchetKeyPair,
    );
    if (usedOneTimePreKey) {
      await deps.markOneTimePreKeyUsed(peerId, usedOneTimePreKey);
    }
    // Sealed sender : on N'ÉCRIT PLUS la clé publique d'identité STABLE de
    // l'expéditeur dans `encryption_metadata` (le serveur pouvait la joindre à
    // `profiles.ratchet_identity_key` pour retrouver QUI écrit). Elle est
    // transportée par le payload sealed sender v3 (cf.
    // textEncryption.buildSenderSealed), ou retrouvée côté destinataire via
    // `deps.loadPeerIdentityKey(senderId)`. Rétrocompat : l'ancien trafic
    // conserve `identityKey` dans l'enveloppe.
    initFields = {
      ephemeralPublicKey: init.ephemeralPublicKey,
      usedOneTimePreKey,
      mlKemCiphertext: init.mlKemCiphertext ?? null,
      pq: !!init.mlKemCiphertext,
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
export interface DecryptFromPeerOptions {
  /**
   * Force la reconstruction de la session destinataire depuis un `ratchet-init`
   * (signal explicite : l'appelant sait que la session locale doit être
   * réinitialisée). Sans ce flag, une session existante n'est réécrite que sur
   * détection d'une nouvelle clé de ratchet (ré-init côté pair), et jamais sur
   * simple échec AEAD.
   */
  forceRebuild?: boolean;
  /** Horloge injectable (ms) — défaut `Date.now`. Utile pour tester le rate-limit. */
  now?: () => number;
}

/** Fenêtre de rate-limit des reconstructions d'init (ms). */
const INIT_REBUILD_WINDOW_MS = 60_000;
/** Nombre max de reconstructions d'init par fenêtre et par session. */
const INIT_REBUILD_MAX = 4;
const initRebuildHistory = new Map<string, number[]>();

/**
 * Autorise (et enregistre) la reconstruction d'une session EXISTANTE. Bornée
 * pour empêcher qu'un flot de `ratchet-init` forgés/rejoués ne détruise la
 * session en boucle (DoS d'état). Le tout premier build (aucune session) n'est
 * PAS concerné.
 */
function allowInitRebuild(key: string, now: number): boolean {
  const recent = (initRebuildHistory.get(key) ?? []).filter(t => now - t < INIT_REBUILD_WINDOW_MS);
  if (recent.length >= INIT_REBUILD_MAX) {
    initRebuildHistory.set(key, recent);
    return false;
  }
  recent.push(now);
  initRebuildHistory.set(key, recent);
  return true;
}

/** Réinitialise le rate-limit des reconstructions (tests / « reset chiffrement »). */
export function resetInitRebuildRateLimit(): void {
  initRebuildHistory.clear();
}

export async function decryptFromPeer(
  deps: RatchetServiceDeps,
  userId: string,
  sessionId: string,
  envelope: RatchetEnvelope,
  content: string,
  senderId?: string | null,
  senderIdentityKey?: string | null,
  opts?: DecryptFromPeerOptions,
): Promise<string> {
  const buildReceiverSession = async (): Promise<SessionState | null> => {
    const localKeys = await deps.loadLocalKeys(userId);
    if (!localKeys) return null;
    // Fail-closed : on ne construit JAMAIS une session destinataire en mode
    // dégradé (sans ML-KEM) si nous avons publié une clé post-quantique. On
    // SIGNALE toute tentative de downgrade (observable), avant de refuser.
    try {
      assertPqNotDowngraded(localKeys, envelope);
    } catch (e) {
      if (e instanceof PqDowngradeError) {
        emitRatchetSecurityEvent({
          type: 'pq-downgrade-receive',
          userId,
          peerId: senderId ?? 'inconnu',
          message: e.message,
        });
      }
      throw e;
    }
    if (!envelope.ephemeralPublicKey) return null;

    // Identité de l'initiateur, par ordre de priorité :
    //   1. enveloppe (ancien trafic, stockée en clair) ;
    //   2. payload sealed sender v3 (`ik` transporté, vérifié — clé EXACTE de
    //      l'émission, robuste à une rotation) ;
    //   3. `profiles.ratchet_identity_key(senderId)` (expéditeur AUTHENTIFIÉ).
    const peerIdentityKey =
      envelope.identityKey ??
      senderIdentityKey ??
      (senderId ? await deps.loadPeerIdentityKey(senderId) : null);
    if (!peerIdentityKey) return null;

    const oneTimePreKeyPublic = envelope.usedOneTimePreKey ?? null;
    let oneTimePreKey: RawKeyPair | null = null;
    if (oneTimePreKeyPublic) {
      const priv = localKeys.oneTimePreKeys[oneTimePreKeyPublic];
      if (priv) oneTimePreKey = { privateKey: priv, publicKey: oneTimePreKeyPublic };
    }

    // Hybride post-quantique : on décapsule le ciphertext ML-KEM avec NOTRE
    // clé secrète. Invariant : la clé publique publiée == cette clé secrète
    // (garanti par `keyStore.ensureMlKem`). Sinon on retombe sur X25519.
    const resp = await x3dhRespond(
      localKeys.identityKeyPair,
      localKeys.signedPreKey,
      oneTimePreKey,
      peerIdentityKey,
      envelope.ephemeralPublicKey,
      envelope.pq ? envelope.mlKemCiphertext ?? null : null,
      envelope.pq ? localKeys.mlKemKeyPair?.secretKey ?? null : null,
    );
    return initReceiverSession(resp.rootKey, localKeys.signedPreKey, resp.associatedData);
  };

  let session = await deps.loadSession(userId, sessionId);

  // On ne reconstruit la session destinataire QUE si :
  //   • aucune session n'existe (première réception) ; OU
  //   • sur signal EXPLICITE de ré-initialisation : `forceRebuild`, ou une clé
  //     de ratchet (éphémère) différente de celle stockée — preuve que le pair
  //     a bien démarré une NOUVELLE session.
  if (envelope.type === 'ratchet-init') {
    const stale =
      !!session &&
      !!session.remoteRatchetPublicKey &&
      session.remoteRatchetPublicKey !== envelope.ephemeralPublicKey;
    const wantsRebuild = !session || stale || opts?.forceRebuild === true;
    if (wantsRebuild) {
      // Le tout premier build est toujours autorisé. RÉÉCRIRE une session
      // existante est borné (rate-limit) : un flot de `ratchet-init` forgés ou
      // rejoués ne doit pas pouvoir détruire la session en boucle (DoS d'état).
      const now = (opts?.now ?? Date.now)();
      if (!session || allowInitRebuild(`${userId}|${sessionId}`, now)) {
        const fresh = await buildReceiverSession();
        if (fresh) session = fresh;
      }
    }
  }

  if (!session) {
    throw new Error('Ratchet: aucune session pour ce message');
  }

  // Plus AUCUNE reconstruction sur échec AEAD : une session valide ne doit
  // jamais être écrasée parce qu'un message (corrompu / rejoué / divergent) a
  // échoué à se déchiffrer. La reprise éventuelle passe par le signal explicite
  // ci-dessus (`forceRebuild` / nouvelle clé de ratchet), pas par un échec.
  const text = await ratchetDecrypt(session, {
    header: envelope.header,
    ivB64: envelope.iv,
    ctB64: content,
  });
  await deps.saveSession(userId, sessionId, session);
  return text;
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
