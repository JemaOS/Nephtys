// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Double Ratchet (Signal) — forward secrecy + post-compromise security.
 *
 * Chaque message utilise une clé unique dérivée d'une chaîne symétrique ;
 * la clé est **détruite après usage**, et un nouveau DH est mélangé à chaque
 * aller-retour (ratchet DH). Conséquence : la compromission d'une clé
 * n'expose ni les messages passés ni les futurs.
 *
 * Champs d'état sérialisables en JSON (persistables en IndexedDB / disque).
 */

import {
  aeadDecrypt,
  aeadEncrypt,
  base64ToBytes,
  bytesToBase64,
  concat,
  dh,
  generateX25519KeyPair,
  kdfChainKey,
  kdfRootKey,
  utf8,
  type RawKeyPair,
} from './primitives';

/** Nombre max de clés sautées conservées (borne anti-DoS). */
const MAX_SKIP = 1000;

export interface RatchetHeader {
  /** Clé publique de ratchet de l'expéditeur. */
  dh: string;
  /** Longueur de la chaîne précédente (permet de sauter proprement). */
  pn: number;
  /** Numéro du message dans la chaîne courante. */
  n: number;
}

export interface RatchetMessage {
  header: RatchetHeader;
  ivB64: string;
  ctB64: string;
}

export interface SessionState {
  rootKey: string;
  selfRatchetPrivateKey: string;
  selfRatchetPublicKey: string;
  remoteRatchetPublicKey: string | null;
  sendingChainKey: string | null;
  receivingChainKey: string | null;
  sendCount: number;
  previousSendCount: number;
  receiveCount: number;
  /** Clés de messages sautés, indexées `"<dh>|<n>"`. */
  skipped: Record<string, string>;
  associatedData: string;
}

function headerBytes(header: RatchetHeader): Uint8Array {
  return utf8(`${header.dh}|${header.pn}|${header.n}`);
}

function associated(header: RatchetHeader, state: SessionState): Uint8Array {
  return concat(base64ToBytes(state.associatedData), headerBytes(header));
}

// ─── Initialisation ───────────────────────────────────────────────────

/**
 * Session côté **initiateur** (Alice), après X3DH.
 * Le premier DH de ratchet utilise la clé de ratchet fournie (sinon générée).
 */
export async function initSenderSession(
  rootKey: Uint8Array,
  remoteRatchetPublicKey: string,
  associatedData: Uint8Array,
  selfRatchetKeyPair: RawKeyPair = generateX25519KeyPair(),
): Promise<SessionState> {
  const [newRoot, sendingChainKey] = await kdfRootKey(
    rootKey,
    dh(selfRatchetKeyPair.privateKey, remoteRatchetPublicKey),
  );
  return {
    rootKey: bytesToBase64(newRoot),
    selfRatchetPrivateKey: selfRatchetKeyPair.privateKey,
    selfRatchetPublicKey: selfRatchetKeyPair.publicKey,
    remoteRatchetPublicKey,
    sendingChainKey: bytesToBase64(sendingChainKey),
    receivingChainKey: null,
    sendCount: 0,
    previousSendCount: 0,
    receiveCount: 0,
    skipped: {},
    associatedData: bytesToBase64(associatedData),
  };
}

/**
 * Session côté **destinataire** (Bob), après X3DH.
 * `selfRatchetKeyPair` doit être la paire de signed prekey utilisée (elle sera
 * consommée par le premier DH ratchet entrant).
 */
export function initReceiverSession(
  rootKey: Uint8Array,
  selfRatchetKeyPair: RawKeyPair,
  associatedData: Uint8Array,
): SessionState {
  return {
    rootKey: bytesToBase64(rootKey),
    selfRatchetPrivateKey: selfRatchetKeyPair.privateKey,
    selfRatchetPublicKey: selfRatchetKeyPair.publicKey,
    remoteRatchetPublicKey: null,
    sendingChainKey: null,
    receivingChainKey: null,
    sendCount: 0,
    previousSendCount: 0,
    receiveCount: 0,
    skipped: {},
    associatedData: bytesToBase64(associatedData),
  };
}

// ─── Chiffrement / déchiffrement ──────────────────────────────────────

export async function ratchetEncrypt(state: SessionState, plaintext: string): Promise<RatchetMessage> {
  if (!state.sendingChainKey) {
    throw new Error('Ratchet: aucune chaîne d’envoi (session non initialisée ou en attente)');
  }
  const [nextChainKey, messageKey] = await kdfChainKey(base64ToBytes(state.sendingChainKey));
  state.sendingChainKey = bytesToBase64(nextChainKey);

  const header: RatchetHeader = {
    dh: state.selfRatchetPublicKey,
    pn: state.previousSendCount,
    n: state.sendCount,
  };
  state.sendCount++;

  const { iv, ciphertext } = await aeadEncrypt(messageKey, utf8(plaintext), associated(header, state));
  return { header, ivB64: bytesToBase64(iv), ctB64: bytesToBase64(ciphertext) };
}

export async function ratchetDecrypt(
  state: SessionState,
  message: RatchetMessage,
): Promise<string> {
  const { header } = message;
  const ad = associated(header, state);

  // 1) Clé sautée déjà stockée ?
  const skippedKey = `${header.dh}|${header.n}`;
  const stored = state.skipped[skippedKey];
  if (stored) {
    delete state.skipped[skippedKey];
    const pt = await aeadDecrypt(
      base64ToBytes(stored),
      base64ToBytes(message.ivB64),
      base64ToBytes(message.ctB64),
      ad,
    );
    return new TextDecoder().decode(pt);
  }

  // 2) Nouveau ratchet DH si la clé publique distant a changé.
  if (!state.remoteRatchetPublicKey || header.dh !== state.remoteRatchetPublicKey) {
    await skipMessageKeys(state, header.pn);
    await dhRatchet(state, header.dh);
  }

  // 3) Sauter jusqu'au message courant puis le déchiffrer.
  await skipMessageKeys(state, header.n);
  if (!state.receivingChainKey) {
    throw new Error('Ratchet: aucune chaîne de réception');
  }
  const [nextChainKey, messageKey] = await kdfChainKey(base64ToBytes(state.receivingChainKey));
  state.receivingChainKey = bytesToBase64(nextChainKey);
  state.receiveCount++;

  const pt = await aeadDecrypt(
    messageKey,
    base64ToBytes(message.ivB64),
    base64ToBytes(message.ctB64),
    ad,
  );
  return new TextDecoder().decode(pt);
}

// ─── Mécanique interne ────────────────────────────────────────────────

async function dhRatchet(state: SessionState, remoteRatchetPublicKey: string): Promise<void> {
  state.previousSendCount = state.sendCount;
  state.sendCount = 0;
  state.receiveCount = 0;
  state.remoteRatchetPublicKey = remoteRatchetPublicKey;

  // Chaîne de réception : DH(ancienne DHs, nouvelle DHr).
  const [root1, receivingChainKey] = await kdfRootKey(
    base64ToBytes(state.rootKey),
    dh(state.selfRatchetPrivateKey, remoteRatchetPublicKey),
  );
  state.rootKey = bytesToBase64(root1);
  state.receivingChainKey = bytesToBase64(receivingChainKey);

  // Nouvelle paire de ratchet → chaîne d'envoi : DH(nouvelle DHs, DHr).
  const self = generateX25519KeyPair();
  state.selfRatchetPrivateKey = self.privateKey;
  state.selfRatchetPublicKey = self.publicKey;
  const [root2, sendingChainKey] = await kdfRootKey(
    base64ToBytes(state.rootKey),
    dh(self.privateKey, remoteRatchetPublicKey),
  );
  state.rootKey = bytesToBase64(root2);
  state.sendingChainKey = bytesToBase64(sendingChainKey);
}

async function skipMessageKeys(state: SessionState, until: number): Promise<void> {
  if (!state.receivingChainKey) return;
  if (state.receiveCount + MAX_SKIP < until) {
    throw new Error('Ratchet: trop de messages sautés (garde-fou)');
  }
  while (state.receiveCount < until) {
    const [nextChainKey, messageKey] = await kdfChainKey(base64ToBytes(state.receivingChainKey));
    state.skipped[`${state.remoteRatchetPublicKey}|${state.receiveCount}`] = bytesToBase64(messageKey);
    state.receivingChainKey = bytesToBase64(nextChainKey);
    state.receiveCount++;
  }
}

// ─── Sérialisation ────────────────────────────────────────────────────

export function serializeSession(state: SessionState): string {
  return JSON.stringify(state);
}

export function deserializeSession(json: string): SessionState {
  return JSON.parse(json) as SessionState;
}
