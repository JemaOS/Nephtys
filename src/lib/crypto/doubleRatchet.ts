// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Double Ratchet Algorithm Implementation
 * 
 * Implements the Signal Protocol's Double Ratchet Algorithm for end-to-end encryption.
 * This provides:
 * 
 * - Perfect Forward Secrecy (PFS): Compromising current keys doesn't reveal past messages
 * - Post-Compromise Security: New keys are derived after each exchange
 * - Out-of-order message handling: Messages can be received in any order
 * - Message key derivation: Unique key for each message
 * 
 * The algorithm combines:
 * 1. DH Ratchet: Updates keys with each DH exchange (when receiving)
 * 2. Symmetric Ratchet: Derives new keys for each message sent/received
 * 
 * @module crypto/doubleRatchet
 */

import { x25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';
import { kdfRK, kdfCK, deriveMessageKeys, deriveHeaderKeys } from './hkdf';
import { generateX25519KeyPair, KeyPair } from './x3dh';

/**
 * Maximum number of skipped message keys to store
 * Prevents memory exhaustion attacks
 */
const MAX_SKIP = 1000;

/**
 * Ratchet state for a session
 * 
 * This state must be securely stored and never transmitted.
 */
export interface RatchetState {
  /** Our current DH key pair (X25519) */
  DHs: KeyPair;
  /** Their current DH public key (null until first message received) */
  DHr: Uint8Array | null;
  /** Root key (32 bytes) - used to derive chain keys */
  RK: Uint8Array;
  /** Sending chain key (null until initialized) */
  CKs: Uint8Array | null;
  /** Receiving chain key (null until first message received) */
  CKr: Uint8Array | null;
  /** Message number for sending */
  Ns: number;
  /** Message number for receiving */
  Nr: number;
  /** Previous sending chain length (for header) */
  PN: number;
  /** Skipped message keys: Map<"publicKey:messageNumber", messageKey> */
  MKSKIPPED: Map<string, Uint8Array>;
}

/**
 * Message header (sent with each message)
 */
export interface MessageHeader {
  /** DH public key (32 bytes) */
  dh: Uint8Array;
  /** Previous chain length */
  pn: number;
  /** Message number in current chain */
  n: number;
}

/**
 * Encrypted message structure
 */
export interface EncryptedMessage {
  /** Encrypted header */
  header: Uint8Array;
  /** Encrypted message content */
  ciphertext: Uint8Array;
  /** Nonce for message encryption (12 bytes) */
  nonce: Uint8Array;
  /** Nonce for header encryption (12 bytes) */
  headerNonce: Uint8Array;
}

/**
 * Serialized ratchet state for storage
 */
export interface SerializedRatchetState {
  DHsPublic: string;
  DHsPrivate: string;
  DHr: string | null;
  RK: string;
  CKs: string | null;
  CKr: string | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Array<[string, string]>;
}

/**
 * Initialize the Double Ratchet as Alice (initiator)
 * 
 * Alice initiates the session after X3DH key agreement.
 * She knows Bob's signed pre-key (used as initial DHr).
 * 
 * @param SK - Shared secret from X3DH (32 bytes)
 * @param bobPublicKey - Bob's signed pre-key public key (32 bytes)
 * @returns Initialized RatchetState for Alice
 * 
 * @example
 * ```typescript
 * // After X3DH
 * const { sharedSecret } = x3dhInitiator(aliceIdentity, aliceEphemeral, bobBundle);
 * const state = ratchetInitAlice(sharedSecret, bobBundle.signedPreKey);
 * ```
 */
export function ratchetInitAlice(SK: Uint8Array, bobPublicKey: Uint8Array): RatchetState {
  // Generate Alice's initial DH key pair
  const DHs = generateX25519KeyPair();
  
  // Perform DH with Bob's public key
  const dhOutput = x25519.getSharedSecret(DHs.privateKey, bobPublicKey);
  
  // Derive initial root key and sending chain key
  const [RK, CKs] = kdfRK(SK, dhOutput);
  
  return {
    DHs,
    DHr: bobPublicKey,
    RK,
    CKs,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

/**
 * Initialize the Double Ratchet as Bob (responder)
 * 
 * Bob initializes after receiving Alice's first message.
 * He uses his signed pre-key as the initial DH key pair.
 * 
 * @param SK - Shared secret from X3DH (32 bytes)
 * @param bobKeyPair - Bob's signed pre-key pair
 * @returns Initialized RatchetState for Bob
 * 
 * @example
 * ```typescript
 * // After X3DH
 * const sharedSecret = x3dhResponder(bobIdentity, bobSignedPreKey, ...);
 * const state = ratchetInitBob(sharedSecret, bobSignedPreKey);
 * ```
 */
export function ratchetInitBob(SK: Uint8Array, bobKeyPair: KeyPair): RatchetState {
  return {
    DHs: bobKeyPair,
    DHr: null,
    RK: SK,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map()
  };
}

/**
 * Encrypt a message using the Double Ratchet
 * 
 * Performs a symmetric ratchet step and encrypts the message.
 * The header contains the current DH public key and message numbers.
 * 
 * @param state - Current ratchet state
 * @param plaintext - Message to encrypt
 * @returns Tuple of [newState, encryptedMessage]
 * 
 * @example
 * ```typescript
 * const message = new TextEncoder().encode("Hello, Bob!");
 * const [newState, encrypted] = ratchetEncrypt(state, message);
 * state = newState; // Update state
 * // Send encrypted to Bob
 * ```
 */
export function ratchetEncrypt(
  state: RatchetState,
  plaintext: Uint8Array
): [RatchetState, EncryptedMessage] {
  // Clone state to avoid mutation
  const newState = cloneState(state);
  
  if (!newState.CKs) {
    throw new Error('Sending chain key not initialized');
  }
  
  // Derive message key from chain key
  const [CKs, mk] = kdfCK(newState.CKs);
  newState.CKs = CKs;
  
  // Create header
  const header: MessageHeader = {
    dh: newState.DHs.publicKey,
    pn: newState.PN,
    n: newState.Ns
  };
  
  // Increment message number
  newState.Ns++;
  
  // Derive encryption keys from message key
  const { encryptionKey } = deriveMessageKeys(mk);
  
  // Encrypt the message with AES-256-GCM
  const nonce = randomBytes(12);
  const cipher = gcm(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);
  
  // Encrypt the header
  const headerBytes = serializeHeader(header);
  const { headerKey } = deriveHeaderKeys(newState.CKs);
  const headerNonce = randomBytes(12);
  const headerCipher = gcm(headerKey, headerNonce);
  const encryptedHeader = headerCipher.encrypt(headerBytes);
  
  const encrypted: EncryptedMessage = {
    header: encryptedHeader,
    ciphertext,
    nonce,
    headerNonce
  };
  
  return [newState, encrypted];
}

/**
 * Decrypt a message using the Double Ratchet
 * 
 * Handles DH ratchet steps when receiving from a new DH key,
 * and symmetric ratchet steps for each message.
 * 
 * @param state - Current ratchet state
 * @param message - Encrypted message to decrypt
 * @returns Tuple of [newState, plaintext]
 * 
 * @throws Error if decryption fails or message key not found
 * 
 * @example
 * ```typescript
 * const [newState, plaintext] = ratchetDecrypt(state, encrypted);
 * state = newState; // Update state
 * const message = new TextDecoder().decode(plaintext);
 * ```
 */
export function ratchetDecrypt(
  state: RatchetState,
  message: EncryptedMessage
): [RatchetState, Uint8Array] {
  // Clone state to avoid mutation
  let newState = cloneState(state);
  
  // Try to decrypt header
  const header = tryDecryptHeader(newState, message);
  
  if (!header) {
    throw new Error('Failed to decrypt message header');
  }
  
  // Try skipped message keys first
  const skippedKey = trySkippedMessageKeys(newState, header, message);
  if (skippedKey) {
    return skippedKey;
  }
  
  // Check if we need to perform a DH ratchet
  if (!newState.DHr || !constantTimeEqual(header.dh, newState.DHr)) {
    // Skip any missed messages in the current receiving chain
    newState = skipMessageKeys(newState, header.pn);
    
    // Perform DH ratchet
    newState = dhRatchet(newState, header);
  }
  
  // Skip any missed messages in the new receiving chain
  newState = skipMessageKeys(newState, header.n);
  
  // Derive message key
  if (!newState.CKr) {
    throw new Error('Receiving chain key not initialized');
  }
  
  const [CKr, mk] = kdfCK(newState.CKr);
  newState.CKr = CKr;
  newState.Nr++;
  
  // Decrypt the message
  const { encryptionKey } = deriveMessageKeys(mk);
  const cipher = gcm(encryptionKey, message.nonce);
  
  try {
    const plaintext = cipher.decrypt(message.ciphertext);
    return [newState, plaintext];
  } catch {
    throw new Error('Message decryption failed - invalid ciphertext or key');
  }
}

/**
 * Perform a DH ratchet step
 * 
 * Called when receiving a message with a new DH public key.
 * Updates the root key and derives new chain keys.
 */
function dhRatchet(state: RatchetState, header: MessageHeader): RatchetState {
  const newState = cloneState(state);
  
  // Store previous chain length
  newState.PN = newState.Ns;
  newState.Ns = 0;
  newState.Nr = 0;
  
  // Update their DH public key
  newState.DHr = header.dh;
  
  // Derive new receiving chain key
  const dhOutput1 = x25519.getSharedSecret(newState.DHs.privateKey, newState.DHr);
  const [RK1, CKr] = kdfRK(newState.RK, dhOutput1);
  newState.RK = RK1;
  newState.CKr = CKr;
  
  // Generate new DH key pair
  newState.DHs = generateX25519KeyPair();
  
  // Derive new sending chain key
  const dhOutput2 = x25519.getSharedSecret(newState.DHs.privateKey, newState.DHr);
  const [RK2, CKs] = kdfRK(newState.RK, dhOutput2);
  newState.RK = RK2;
  newState.CKs = CKs;
  
  return newState;
}

/**
 * Skip message keys for out-of-order messages
 * 
 * Stores skipped message keys so out-of-order messages can be decrypted.
 */
function skipMessageKeys(state: RatchetState, until: number): RatchetState {
  const newState = cloneState(state);
  
  if (!newState.CKr) {
    return newState;
  }
  
  if (newState.Nr + MAX_SKIP < until) {
    throw new Error('Too many skipped messages');
  }
  
  while (newState.Nr < until) {
    const [CKr, mk] = kdfCK(newState.CKr);
    newState.CKr = CKr;
    
    // Store the skipped message key
    const key = makeSkippedKey(newState.DHr as Uint8Array, newState.Nr);
    newState.MKSKIPPED.set(key, mk);
    
    newState.Nr++;
  }
  
  return newState;
}

/**
 * Try to decrypt using skipped message keys
 */
function trySkippedMessageKeys(
  state: RatchetState,
  header: MessageHeader,
  message: EncryptedMessage
): [RatchetState, Uint8Array] | null {
  const key = makeSkippedKey(header.dh, header.n);
  const mk = state.MKSKIPPED.get(key);
  
  if (!mk) {
    return null;
  }
  
  // Clone state and remove the used key
  const newState = cloneState(state);
  newState.MKSKIPPED.delete(key);
  
  // Decrypt the message
  const { encryptionKey } = deriveMessageKeys(mk);
  const cipher = gcm(encryptionKey, message.nonce);
  
  try {
    const plaintext = cipher.decrypt(message.ciphertext);
    return [newState, plaintext];
  } catch {
    return null;
  }
}

/**
 * Try to decrypt the message header
 */
function tryDecryptHeader(
  state: RatchetState,
  message: EncryptedMessage
): MessageHeader | null {
  // Try with current receiving chain key
  if (state.CKr) {
    const { headerKey } = deriveHeaderKeys(state.CKr);
    const header = decryptHeader(message, headerKey);
    if (header) return header;
  }
  
  // Try with sending chain key (for our own messages or initial state)
  if (state.CKs) {
    const { headerKey } = deriveHeaderKeys(state.CKs);
    const header = decryptHeader(message, headerKey);
    if (header) return header;
  }
  
  // For initial messages, try deriving header key from root key
  const { headerKey } = deriveHeaderKeys(state.RK);
  return decryptHeader(message, headerKey);
}

/**
 * Decrypt a header with a specific key
 */
function decryptHeader(
  message: EncryptedMessage,
  headerKey: Uint8Array
): MessageHeader | null {
  try {
    const cipher = gcm(headerKey, message.headerNonce);
    const headerBytes = cipher.decrypt(message.header);
    return deserializeHeader(headerBytes);
  } catch {
    return null;
  }
}

/**
 * Serialize a message header to bytes
 */
function serializeHeader(header: MessageHeader): Uint8Array {
  // Format: dh (32 bytes) + pn (4 bytes) + n (4 bytes) = 40 bytes
  const bytes = new Uint8Array(40);
  bytes.set(header.dh, 0);
  
  const view = new DataView(bytes.buffer);
  view.setUint32(32, header.pn, true);
  view.setUint32(36, header.n, true);
  
  return bytes;
}

/**
 * Deserialize a message header from bytes
 */
function deserializeHeader(bytes: Uint8Array): MessageHeader {
  if (bytes.length !== 40) {
    throw new Error('Invalid header length');
  }
  
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  
  return {
    dh: bytes.slice(0, 32),
    pn: view.getUint32(32, true),
    n: view.getUint32(36, true)
  };
}

/**
 * Create a key for the skipped message keys map
 */
function makeSkippedKey(dh: Uint8Array, n: number): string {
  return `${bytesToHex(dh)}:${n}`;
}

/**
 * Clone a ratchet state (deep copy)
 */
function cloneState(state: RatchetState): RatchetState {
  return {
    DHs: {
      publicKey: new Uint8Array(state.DHs.publicKey),
      privateKey: new Uint8Array(state.DHs.privateKey)
    },
    DHr: state.DHr ? new Uint8Array(state.DHr) : null,
    RK: new Uint8Array(state.RK),
    CKs: state.CKs ? new Uint8Array(state.CKs) : null,
    CKr: state.CKr ? new Uint8Array(state.CKr) : null,
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    MKSKIPPED: new Map(state.MKSKIPPED)
  };
}

/**
 * Constant-time comparison of two byte arrays
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Serialize ratchet state for secure storage
 * 
 * @param state - Ratchet state to serialize
 * @returns Serialized state object
 */
export function serializeRatchetState(state: RatchetState): SerializedRatchetState {
  return {
    DHsPublic: bytesToHex(state.DHs.publicKey),
    DHsPrivate: bytesToHex(state.DHs.privateKey),
    DHr: state.DHr ? bytesToHex(state.DHr) : null,
    RK: bytesToHex(state.RK),
    CKs: state.CKs ? bytesToHex(state.CKs) : null,
    CKr: state.CKr ? bytesToHex(state.CKr) : null,
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    MKSKIPPED: Array.from(state.MKSKIPPED.entries()).map(([k, v]) => [k, bytesToHex(v)])
  };
}

/**
 * Deserialize ratchet state from storage
 * 
 * @param serialized - Serialized state object
 * @returns Ratchet state
 */
export function deserializeRatchetState(serialized: SerializedRatchetState): RatchetState {
  return {
    DHs: {
      publicKey: hexToBytes(serialized.DHsPublic),
      privateKey: hexToBytes(serialized.DHsPrivate)
    },
    DHr: serialized.DHr ? hexToBytes(serialized.DHr) : null,
    RK: hexToBytes(serialized.RK),
    CKs: serialized.CKs ? hexToBytes(serialized.CKs) : null,
    CKr: serialized.CKr ? hexToBytes(serialized.CKr) : null,
    Ns: serialized.Ns,
    Nr: serialized.Nr,
    PN: serialized.PN,
    MKSKIPPED: new Map(serialized.MKSKIPPED.map(([k, v]) => [k, hexToBytes(v)]))
  };
}

/**
 * Encrypt a message with associated data (AEAD)
 * 
 * This is a lower-level function for encrypting with explicit associated data.
 * 
 * @param key - Encryption key (32 bytes)
 * @param nonce - Nonce (12 bytes)
 * @param plaintext - Data to encrypt
 * @param associatedData - Additional authenticated data
 * @returns Ciphertext with authentication tag
 */
export function encryptAEAD(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  associatedData?: Uint8Array
): Uint8Array {
  const cipher = gcm(key, nonce, associatedData);
  return cipher.encrypt(plaintext);
}

/**
 * Decrypt a message with associated data (AEAD)
 * 
 * @param key - Encryption key (32 bytes)
 * @param nonce - Nonce (12 bytes)
 * @param ciphertext - Data to decrypt
 * @param associatedData - Additional authenticated data
 * @returns Plaintext
 * @throws Error if authentication fails
 */
export function decryptAEAD(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  associatedData?: Uint8Array
): Uint8Array {
  const cipher = gcm(key, nonce, associatedData);
  return cipher.decrypt(ciphertext);
}

/**
 * Generate a random nonce for AES-GCM
 * 
 * @returns 12-byte random nonce
 */
export function generateNonce(): Uint8Array {
  return randomBytes(12);
}

/**
 * Encrypt a message for a session (high-level API)
 * 
 * @param state - Current ratchet state
 * @param message - String message to encrypt
 * @returns Tuple of [newState, encryptedMessage]
 */
export function encryptMessage(
  state: RatchetState,
  message: string
): [RatchetState, EncryptedMessage] {
  const plaintext = new TextEncoder().encode(message);
  return ratchetEncrypt(state, plaintext);
}

/**
 * Decrypt a message for a session (high-level API)
 * 
 * @param state - Current ratchet state
 * @param encrypted - Encrypted message
 * @returns Tuple of [newState, decryptedMessage]
 */
export function decryptMessage(
  state: RatchetState,
  encrypted: EncryptedMessage
): [RatchetState, string] {
  const [newState, plaintext] = ratchetDecrypt(state, encrypted);
  return [newState, new TextDecoder().decode(plaintext)];
}

/**
 * Serialize an encrypted message for transmission
 * 
 * @param message - Encrypted message
 * @returns Base64-encoded string
 */
export function serializeEncryptedMessage(message: EncryptedMessage): string {
  const headerLen = message.header.length;
  const ciphertextLen = message.ciphertext.length;
  
  // Format: headerLen (4) + header + ciphertextLen (4) + ciphertext + nonce (12) + headerNonce (12)
  const totalLen = 4 + headerLen + 4 + ciphertextLen + 12 + 12;
  const bytes = new Uint8Array(totalLen);
  const view = new DataView(bytes.buffer);
  
  let offset = 0;
  
  view.setUint32(offset, headerLen, true);
  offset += 4;
  
  bytes.set(message.header, offset);
  offset += headerLen;
  
  view.setUint32(offset, ciphertextLen, true);
  offset += 4;
  
  bytes.set(message.ciphertext, offset);
  offset += ciphertextLen;
  
  bytes.set(message.nonce, offset);
  offset += 12;
  
  bytes.set(message.headerNonce, offset);
  
  return btoa(String.fromCodePoint(...bytes));
}

/**
 * Deserialize an encrypted message from transmission
 * 
 * @param encoded - Base64-encoded string
 * @returns Encrypted message
 */
export function deserializeEncryptedMessage(encoded: string): EncryptedMessage {
  const bytes = new Uint8Array(
    atob(encoded).split('').map(c => c.codePointAt(0) || 0)
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  
  let offset = 0;
  
  const headerLen = view.getUint32(offset, true);
  offset += 4;
  
  const header = bytes.slice(offset, offset + headerLen);
  offset += headerLen;
  
  const ciphertextLen = view.getUint32(offset, true);
  offset += 4;
  
  const ciphertext = bytes.slice(offset, offset + ciphertextLen);
  offset += ciphertextLen;
  
  const nonce = bytes.slice(offset, offset + 12);
  offset += 12;
  
  const headerNonce = bytes.slice(offset, offset + 12);
  
  return {
    header,
    ciphertext,
    nonce,
    headerNonce
  };
}

/**
 * Create a new session as initiator (Alice)
 * 
 * High-level function to establish a Double Ratchet session after X3DH.
 * 
 * @param sharedSecret - Shared secret from X3DH
 * @param theirPublicKey - Their DH public key
 * @returns Initialized ratchet state
 */
export function createSessionAsInitiator(
  sharedSecret: Uint8Array,
  theirPublicKey: Uint8Array
): RatchetState {
  return ratchetInitAlice(sharedSecret, theirPublicKey);
}

/**
 * Create a new session as responder (Bob)
 * 
 * High-level function to establish a Double Ratchet session after X3DH.
 * 
 * @param sharedSecret - Shared secret from X3DH
 * @param ourKeyPair - Our DH key pair
 * @returns Initialized ratchet state
 */
export function createSessionAsResponder(
  sharedSecret: Uint8Array,
  ourKeyPair: KeyPair
): RatchetState {
  return ratchetInitBob(sharedSecret, ourKeyPair);
}
