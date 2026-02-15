// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Military-Grade E2EE Cryptographic Module
 *
 * This module implements the Signal Protocol for end-to-end encryption,
 * providing military-grade security for the Anu messaging application.
 *
 * Components:
 * - HKDF: Key derivation functions (RFC 5869)
 * - Signatures: Ed25519 digital signatures
 * - X3DH: Extended Triple Diffie-Hellman key agreement
 * - Double Ratchet: Forward-secure message encryption
 * - WebRTC E2EE: Insertable Streams for media encryption
 * - Key Storage: Secure encrypted storage for keys
 *
 * Security Properties:
 * - Perfect Forward Secrecy (PFS)
 * - Post-Compromise Security
 * - Deniable Authentication
 * - Asynchronous Operation
 * - Frame-level media encryption
 * - Encrypted key storage at rest
 *
 * @module crypto
 */

// ============================================================================
// HKDF - Key Derivation Functions
// ============================================================================

export {
  hkdf,
  hkdfExtract,
  hkdfExpand,
  deriveKeys,
  kdfRK,
  kdfCK,
  deriveMessageKeys,
  deriveHeaderKeys
} from './hkdf';

// ============================================================================
// Digital Signatures (Ed25519)
// ============================================================================

export {
  generateSigningKeyPair,
  sign,
  verify,
  signData,
  verifySignedData,
  verifySignedDataFrom,
  constantTimeEqual,
  ed25519PublicKeyToX25519,
  serializeKeyPair,
  deserializeKeyPair,
  signPreKey,
  verifyPreKeySignature
} from './signatures';

export type {
  Ed25519KeyPair,
  SignedData
} from './signatures';

// ============================================================================
// X3DH - Extended Triple Diffie-Hellman Key Agreement
// ============================================================================

export {
  generateX25519KeyPair,
  x25519DH,
  generateKeyBundle,
  getPublicKeyBundle,
  verifyKeyBundle,
  x3dhInitiator,
  x3dhResponder,
  createInitialMessage,
  generateOneTimePreKeys,
  rotateSignedPreKey,
  serializePublicKeyBundle,
  deserializePublicKeyBundle
} from './x3dh';

// Import for internal use
import { generateX25519KeyPair as _generateX25519KeyPair } from './x3dh';

export type {
  X25519KeyPair,
  KeyPair,
  SignedPreKey,
  OneTimePreKey,
  KeyBundle,
  PublicKeyBundle,
  X3DHInitiatorResult,
  X3DHInitialMessage
} from './x3dh';

// ============================================================================
// Double Ratchet Algorithm
// ============================================================================

export {
  ratchetInitAlice,
  ratchetInitBob,
  ratchetEncrypt,
  ratchetDecrypt,
  serializeRatchetState,
  deserializeRatchetState,
  encryptAEAD,
  decryptAEAD,
  generateNonce,
  encryptMessage,
  decryptMessage,
  serializeEncryptedMessage,
  deserializeEncryptedMessage,
  createSession
} from './doubleRatchet';

export type {
  RatchetState,
  MessageHeader,
  EncryptedMessage,
  SerializedRatchetState
} from './doubleRatchet';

// ============================================================================
// WebRTC E2EE (Insertable Streams)
// ============================================================================

export {
  supportsInsertableStreams,
  deriveFrameKey,
  E2EETransformSender,
  E2EETransformReceiver,
  WebRTCE2EEManager,
  createE2EEManager
} from './webrtcE2EE';

export type {
  E2EEContext,
  E2EEEncodedVideoFrame,
  E2EEEncodedAudioFrame,
  E2EEEncodedVideoFrameMetadata,
  E2EEEncodedAudioFrameMetadata
} from './webrtcE2EE';

// ============================================================================
// Secure Key Storage
// ============================================================================

export {
  SecureKeyStorage,
  getSecureKeyStorage,
  resetSecureKeyStorage
} from './keyStorage';

export type {
  EncryptedKeyPair,
  StoredKeyBundle
} from './keyStorage';

// ============================================================================
// E2EE Messaging Service
// ============================================================================

export {
  E2EEMessagingService,
  getMessagingService,
  resetMessagingService,
  messagingService
} from './messagingService';

export type {
  EncryptedMessagePayload
} from './messagingService';

// ============================================================================
// Group Encryption (Sender Keys Protocol)
// ============================================================================

export {
  GroupEncryptionManager,
  getGroupEncryptionManager,
  resetGroupEncryptionManager,
  serializeGroupMessage,
  deserializeGroupMessage,
  serializeSenderKeyDistribution,
  deserializeSenderKeyDistribution
} from './groupEncryption';

export type {
  SenderKey,
  GroupState,
  EncryptedGroupMessage,
  SerializedGroupMessage,
  SenderKeyDistribution,
  SerializedSenderKeyDistribution
} from './groupEncryption';

// ============================================================================
// Migration Utilities
// ============================================================================

export {
  migrateToMilitaryGradeE2EE,
  verifyMigrationToken,
  notifyContactsOfKeyChange,
  processKeyChangeNotification,
  getMigrationStatus,
  exportKeysForBackup,
  importKeysFromBackup,
  cleanupOldEncryptionData
} from './migration';

export type {
  MigrationResult,
  MigrationStatus,
  NotificationResult
} from './migration';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate cryptographically secure random bytes
 *
 * @param length - Number of bytes to generate
 * @returns Random bytes
 */
export function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Securely compare two byte arrays in constant time
 * 
 * @param a - First array
 * @param b - Second array
 * @returns true if equal
 */
export function secureCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
}

/**
 * Convert bytes to hexadecimal string
 * 
 * @param bytes - Bytes to convert
 * @returns Hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hexadecimal string to bytes
 * 
 * @param hex - Hex string to convert
 * @returns Bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to Base64 string
 * 
 * @param bytes - Bytes to convert
 * @returns Base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert Base64 string to bytes
 * 
 * @param base64 - Base64 string to convert
 * @returns Bytes
 */
export function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(
    atob(base64).split('').map(c => c.charCodeAt(0))
  );
}

/**
 * Securely clear sensitive data from memory
 * 
 * Note: This is a best-effort operation. JavaScript doesn't guarantee
 * that memory will be immediately cleared or that copies won't exist.
 * 
 * @param data - Data to clear
 */
export function secureClear(data: Uint8Array): void {
  data.fill(0);
}

// ============================================================================
// High-Level Session Management
// ============================================================================

import {
  generateKeyBundle as _generateKeyBundle,
  getPublicKeyBundle as _getPublicKeyBundle,
  x3dhInitiator as _x3dhInitiator,
  x3dhResponder as _x3dhResponder,
  KeyBundle,
  PublicKeyBundle,
  X25519KeyPair
} from './x3dh';

import {
  ratchetInitAlice as _ratchetInitAlice,
  ratchetInitBob as _ratchetInitBob,
  encryptMessage as _encryptMessage,
  decryptMessage as _decryptMessage,
  RatchetState,
  EncryptedMessage
} from './doubleRatchet';

/**
 * Complete E2EE Session for a conversation
 */
export interface E2EESession {
  /** Session identifier */
  sessionId: string;
  /** Remote party's identity public key */
  remoteIdentityKey: Uint8Array;
  /** Current ratchet state */
  ratchetState: RatchetState;
  /** Whether we initiated this session */
  isInitiator: boolean;
  /** Timestamp of session creation */
  createdAt: number;
  /** Timestamp of last activity */
  lastActivityAt: number;
}

/**
 * User's cryptographic identity
 */
export interface CryptoIdentity {
  /** Full key bundle */
  keyBundle: KeyBundle;
  /** Identity fingerprint (hash of identity public key) */
  fingerprint: string;
}

/**
 * Generate a new cryptographic identity for a user
 * 
 * @param numOneTimeKeys - Number of one-time pre-keys to generate
 * @returns CryptoIdentity
 */
export function generateIdentity(numOneTimeKeys: number = 100): CryptoIdentity {
  const keyBundle = _generateKeyBundle(numOneTimeKeys);
  
  // Generate fingerprint from identity public key
  const fingerprint = bytesToHex(keyBundle.identityKey.publicKey).substring(0, 40);
  
  return {
    keyBundle,
    fingerprint
  };
}

/**
 * Establish a new E2EE session as the initiator
 *
 * @param ourIdentity - Our cryptographic identity
 * @param theirPublicBundle - Their public key bundle
 * @param sessionId - Unique session identifier
 * @returns E2EESession
 */
export function establishSession(
  ourIdentity: CryptoIdentity,
  theirPublicBundle: PublicKeyBundle,
  sessionId: string
): E2EESession {
  // Generate ephemeral key for X3DH
  const ephemeralKey = _generateX25519KeyPair();
  
  // Perform X3DH
  const { sharedSecret } = _x3dhInitiator(
    ourIdentity.keyBundle.identityKey,
    ephemeralKey,
    theirPublicBundle
  );
  
  // Initialize Double Ratchet
  const ratchetState = _ratchetInitAlice(sharedSecret, theirPublicBundle.signedPreKey);
  
  const now = Date.now();
  
  return {
    sessionId,
    remoteIdentityKey: theirPublicBundle.identityKey,
    ratchetState,
    isInitiator: true,
    createdAt: now,
    lastActivityAt: now
  };
}

/**
 * Accept an incoming E2EE session as the responder
 * 
 * @param ourIdentity - Our cryptographic identity
 * @param theirIdentityKey - Their identity public key
 * @param theirEphemeralKey - Their ephemeral public key
 * @param usedOneTimeKeyId - ID of the one-time key they used (if any)
 * @param sessionId - Unique session identifier
 * @returns E2EESession
 */
export function acceptSession(
  ourIdentity: CryptoIdentity,
  theirIdentityKey: Uint8Array,
  theirEphemeralKey: Uint8Array,
  usedOneTimeKeyId: number | undefined,
  sessionId: string
): E2EESession {
  // Find the one-time key if used
  let oneTimeKey: X25519KeyPair | null = null;
  if (usedOneTimeKeyId !== undefined) {
    const otk = ourIdentity.keyBundle.oneTimePreKeys.find(k => k.keyId === usedOneTimeKeyId);
    if (otk) {
      oneTimeKey = otk.keyPair;
    }
  }
  
  // Perform X3DH
  const sharedSecret = _x3dhResponder(
    ourIdentity.keyBundle.identityKey,
    ourIdentity.keyBundle.signedPreKey.keyPair,
    oneTimeKey,
    theirIdentityKey,
    theirEphemeralKey
  );
  
  // Initialize Double Ratchet
  const ratchetState = _ratchetInitBob(
    sharedSecret,
    ourIdentity.keyBundle.signedPreKey.keyPair
  );
  
  const now = Date.now();
  
  return {
    sessionId,
    remoteIdentityKey: theirIdentityKey,
    ratchetState,
    isInitiator: false,
    createdAt: now,
    lastActivityAt: now
  };
}

/**
 * Encrypt a message in an E2EE session
 * 
 * @param session - E2EE session
 * @param message - Message to encrypt
 * @returns Updated session and encrypted message
 */
export function sessionEncrypt(
  session: E2EESession,
  message: string
): { session: E2EESession; encrypted: EncryptedMessage } {
  const [newRatchetState, encrypted] = _encryptMessage(session.ratchetState, message);
  
  return {
    session: {
      ...session,
      ratchetState: newRatchetState,
      lastActivityAt: Date.now()
    },
    encrypted
  };
}

/**
 * Decrypt a message in an E2EE session
 * 
 * @param session - E2EE session
 * @param encrypted - Encrypted message
 * @returns Updated session and decrypted message
 */
export function sessionDecrypt(
  session: E2EESession,
  encrypted: EncryptedMessage
): { session: E2EESession; message: string } {
  const [newRatchetState, message] = _decryptMessage(session.ratchetState, encrypted);
  
  return {
    session: {
      ...session,
      ratchetState: newRatchetState,
      lastActivityAt: Date.now()
    },
    message
  };
}

/**
 * Get the security fingerprint for a session
 * 
 * This can be used for out-of-band verification between users.
 * 
 * @param session - E2EE session
 * @param ourIdentityKey - Our identity public key
 * @returns Security fingerprint string
 */
export function getSecurityFingerprint(
  session: E2EESession,
  ourIdentityKey: Uint8Array
): string {
  // Combine both identity keys in a deterministic order
  const combined = new Uint8Array(64);
  
  // Sort by comparing the keys to ensure same result on both sides
  const comparison = compareBytes(ourIdentityKey, session.remoteIdentityKey);
  
  if (comparison < 0) {
    combined.set(ourIdentityKey, 0);
    combined.set(session.remoteIdentityKey, 32);
  } else {
    combined.set(session.remoteIdentityKey, 0);
    combined.set(ourIdentityKey, 32);
  }
  
  // Return hex fingerprint
  return bytesToHex(combined);
}

/**
 * Compare two byte arrays lexicographically
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  
  for (let i = 0; i < minLen; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  
  return a.length - b.length;
}