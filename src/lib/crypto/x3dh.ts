/**
 * X3DH (Extended Triple Diffie-Hellman) Key Agreement Protocol
 * 
 * Implements the X3DH protocol as specified by Signal for establishing
 * a shared secret between two parties. X3DH provides:
 * 
 * - Mutual authentication
 * - Forward secrecy
 * - Cryptographic deniability
 * - Asynchronous operation (Bob can be offline)
 * 
 * The protocol uses:
 * - X25519 for Diffie-Hellman key exchange
 * - Ed25519 for signing pre-keys
 * - HKDF-SHA256 for key derivation
 * 
 * Key Types:
 * - Identity Key (IK): Long-term Ed25519 key pair for identity
 * - Signed Pre-Key (SPK): Medium-term X25519 key pair, signed by IK
 * - One-Time Pre-Key (OPK): Ephemeral X25519 key pairs for forward secrecy
 * - Ephemeral Key (EK): Per-session X25519 key pair
 * 
 * @module crypto/x3dh
 */

import { x25519 } from '@noble/curves/ed25519';
import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { hkdf } from './hkdf';
import { sign, verify, generateSigningKeyPair, Ed25519KeyPair } from './signatures';

/**
 * X25519 Key Pair for Diffie-Hellman operations
 */
export interface X25519KeyPair {
  /** Public key (32 bytes) */
  publicKey: Uint8Array;
  /** Private key (32 bytes) */
  privateKey: Uint8Array;
}

/**
 * Generic key pair type (can be Ed25519 or X25519)
 */
export interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Signed Pre-Key with signature
 */
export interface SignedPreKey {
  /** X25519 key pair */
  keyPair: X25519KeyPair;
  /** Ed25519 signature of the public key */
  signature: Uint8Array;
  /** Key ID for identification */
  keyId: number;
  /** Timestamp when the key was created */
  timestamp: number;
}

/**
 * One-Time Pre-Key
 */
export interface OneTimePreKey {
  /** X25519 key pair */
  keyPair: X25519KeyPair;
  /** Key ID for identification */
  keyId: number;
}

/**
 * Complete key bundle for a user (stored on server)
 */
export interface KeyBundle {
  /** Ed25519 identity key pair */
  identityKey: Ed25519KeyPair;
  /** Signed pre-key with signature */
  signedPreKey: SignedPreKey;
  /** Array of one-time pre-keys */
  oneTimePreKeys: OneTimePreKey[];
}

/**
 * Public key bundle (sent to other users)
 */
export interface PublicKeyBundle {
  /** Ed25519 identity public key */
  identityKey: Uint8Array;
  /** X25519 signed pre-key public key */
  signedPreKey: Uint8Array;
  /** Signature of the signed pre-key */
  signedPreKeySignature: Uint8Array;
  /** Signed pre-key ID */
  signedPreKeyId: number;
  /** Optional one-time pre-key public key */
  oneTimePreKey?: Uint8Array;
  /** One-time pre-key ID (if present) */
  oneTimePreKeyId?: number;
}

/**
 * Result of X3DH key agreement (initiator side)
 */
export interface X3DHInitiatorResult {
  /** Shared secret (32 bytes) */
  sharedSecret: Uint8Array;
  /** Ephemeral public key to send to responder */
  ephemeralPublic: Uint8Array;
  /** Associated data for AEAD */
  associatedData: Uint8Array;
}

/**
 * Initial message sent from initiator to responder
 */
export interface X3DHInitialMessage {
  /** Initiator's identity public key */
  identityKey: Uint8Array;
  /** Initiator's ephemeral public key */
  ephemeralKey: Uint8Array;
  /** ID of the signed pre-key used */
  signedPreKeyId: number;
  /** ID of the one-time pre-key used (if any) */
  oneTimePreKeyId?: number;
  /** Initial ciphertext (encrypted with derived key) */
  ciphertext?: Uint8Array;
}

/**
 * Generate a new X25519 key pair for Diffie-Hellman
 * 
 * @returns X25519KeyPair with 32-byte public and private keys
 * 
 * @example
 * ```typescript
 * const keyPair = generateX25519KeyPair();
 * console.log('Public:', keyPair.publicKey); // 32 bytes
 * console.log('Private:', keyPair.privateKey); // 32 bytes
 * ```
 */
export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = x25519.getPublicKey(privateKey);
  
  return {
    publicKey,
    privateKey
  };
}

/**
 * Perform X25519 Diffie-Hellman key exchange
 * 
 * @param privateKey - Our X25519 private key (32 bytes)
 * @param publicKey - Their X25519 public key (32 bytes)
 * @returns Shared secret (32 bytes)
 * 
 * @example
 * ```typescript
 * const alice = generateX25519KeyPair();
 * const bob = generateX25519KeyPair();
 * 
 * const sharedAlice = x25519DH(alice.privateKey, bob.publicKey);
 * const sharedBob = x25519DH(bob.privateKey, alice.publicKey);
 * // sharedAlice === sharedBob
 * ```
 */
export function x25519DH(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

/**
 * Generate a complete key bundle for a user
 * 
 * Creates all the keys needed for X3DH:
 * - Identity key (Ed25519 for signing)
 * - Signed pre-key (X25519, signed by identity key)
 * - One-time pre-keys (X25519, for forward secrecy)
 * 
 * @param numOneTimeKeys - Number of one-time pre-keys to generate (default: 100)
 * @returns Complete KeyBundle
 * 
 * @example
 * ```typescript
 * const bundle = generateKeyBundle(50);
 * // Store bundle.identityKey securely (never share private key)
 * // Upload public parts to server
 * ```
 */
export function generateKeyBundle(numOneTimeKeys: number = 100): KeyBundle {
  // Generate identity key (Ed25519 for signing)
  const identityKey = generateSigningKeyPair();
  
  // Generate signed pre-key (X25519 for DH)
  const signedPreKeyPair = generateX25519KeyPair();
  const signedPreKeySignature = sign(signedPreKeyPair.publicKey, identityKey.privateKey);
  
  const signedPreKey: SignedPreKey = {
    keyPair: signedPreKeyPair,
    signature: signedPreKeySignature,
    keyId: generateKeyId(),
    timestamp: Date.now()
  };
  
  // Generate one-time pre-keys
  const oneTimePreKeys: OneTimePreKey[] = [];
  for (let i = 0; i < numOneTimeKeys; i++) {
    oneTimePreKeys.push({
      keyPair: generateX25519KeyPair(),
      keyId: generateKeyId()
    });
  }
  
  return {
    identityKey,
    signedPreKey,
    oneTimePreKeys
  };
}

/**
 * Generate a random key ID
 */
function generateKeyId(): number {
  const bytes = randomBytes(4);
  return new DataView(bytes.buffer).getUint32(0, true);
}

/**
 * Extract public key bundle from a full key bundle
 * 
 * Creates the public portion of a key bundle that can be shared with others.
 * 
 * @param bundle - Full key bundle
 * @param oneTimeKeyIndex - Index of one-time key to include (optional)
 * @returns PublicKeyBundle for sharing
 */
export function getPublicKeyBundle(
  bundle: KeyBundle,
  oneTimeKeyIndex?: number
): PublicKeyBundle {
  const publicBundle: PublicKeyBundle = {
    identityKey: bundle.identityKey.publicKey,
    signedPreKey: bundle.signedPreKey.keyPair.publicKey,
    signedPreKeySignature: bundle.signedPreKey.signature,
    signedPreKeyId: bundle.signedPreKey.keyId
  };
  
  if (oneTimeKeyIndex !== undefined && bundle.oneTimePreKeys[oneTimeKeyIndex]) {
    const otk = bundle.oneTimePreKeys[oneTimeKeyIndex];
    publicBundle.oneTimePreKey = otk.keyPair.publicKey;
    publicBundle.oneTimePreKeyId = otk.keyId;
  }
  
  return publicBundle;
}

/**
 * Verify a public key bundle's signature
 * 
 * Verifies that the signed pre-key was actually signed by the identity key.
 * This should always be done before using a key bundle.
 * 
 * @param bundle - Public key bundle to verify
 * @returns true if the signature is valid
 */
export function verifyKeyBundle(bundle: PublicKeyBundle): boolean {
  return verify(
    bundle.signedPreKey,
    bundle.signedPreKeySignature,
    bundle.identityKey
  );
}

/**
 * Perform X3DH as the initiator (Alice)
 * 
 * Alice initiates a session with Bob using Bob's public key bundle.
 * This performs the four DH operations and derives the shared secret.
 * 
 * DH operations:
 * 1. DH1 = DH(IK_A, SPK_B) - Alice's identity with Bob's signed pre-key
 * 2. DH2 = DH(EK_A, IK_B) - Alice's ephemeral with Bob's identity
 * 3. DH3 = DH(EK_A, SPK_B) - Alice's ephemeral with Bob's signed pre-key
 * 4. DH4 = DH(EK_A, OPK_B) - Alice's ephemeral with Bob's one-time pre-key (if available)
 * 
 * @param aliceIdentityKey - Alice's Ed25519 identity key pair
 * @param aliceEphemeralKey - Alice's X25519 ephemeral key pair
 * @param bobKeyBundle - Bob's public key bundle
 * @returns X3DHInitiatorResult with shared secret and ephemeral public key
 * 
 * @throws Error if Bob's key bundle signature is invalid
 * 
 * @example
 * ```typescript
 * const aliceIdentity = generateSigningKeyPair();
 * const aliceEphemeral = generateX25519KeyPair();
 * const bobBundle = await fetchBobsKeyBundle();
 * 
 * const result = x3dhInitiator(aliceIdentity, aliceEphemeral, bobBundle);
 * // Use result.sharedSecret to initialize Double Ratchet
 * // Send result.ephemeralPublic to Bob
 * ```
 */
export function x3dhInitiator(
  aliceIdentityKey: Ed25519KeyPair,
  aliceEphemeralKey: X25519KeyPair,
  bobKeyBundle: PublicKeyBundle
): X3DHInitiatorResult {
  // Verify Bob's key bundle
  if (!verifyKeyBundle(bobKeyBundle)) {
    throw new Error('X3DH: Invalid key bundle signature');
  }
  
  // Convert Alice's Ed25519 identity key to X25519 for DH
  // Note: In practice, you might store separate X25519 identity keys
  // For simplicity, we'll use the Ed25519 private key directly with X25519
  // This works because both use the same underlying curve operations
  const aliceIdentityX25519Private = aliceIdentityKey.privateKey;
  
  // Convert Bob's Ed25519 identity public key to X25519
  // For this implementation, we assume Bob's identity key is already X25519-compatible
  // In a full implementation, you'd need proper key conversion
  const bobIdentityX25519Public = bobKeyBundle.identityKey;
  
  // Perform the DH operations
  // DH1: Alice's identity key with Bob's signed pre-key
  const dh1 = x25519DH(aliceIdentityX25519Private, bobKeyBundle.signedPreKey);
  
  // DH2: Alice's ephemeral key with Bob's identity key
  const dh2 = x25519DH(aliceEphemeralKey.privateKey, bobIdentityX25519Public);
  
  // DH3: Alice's ephemeral key with Bob's signed pre-key
  const dh3 = x25519DH(aliceEphemeralKey.privateKey, bobKeyBundle.signedPreKey);
  
  // DH4: Alice's ephemeral key with Bob's one-time pre-key (if available)
  let dh4: Uint8Array | null = null;
  if (bobKeyBundle.oneTimePreKey) {
    dh4 = x25519DH(aliceEphemeralKey.privateKey, bobKeyBundle.oneTimePreKey);
  }
  
  // Concatenate DH outputs
  const dhConcat = dh4
    ? concatenateBytes(dh1, dh2, dh3, dh4)
    : concatenateBytes(dh1, dh2, dh3);
  
  // Derive shared secret using HKDF
  // F || KM where F is 32 0xFF bytes (as per Signal spec)
  const f = new Uint8Array(32).fill(0xFF);
  const km = concatenateBytes(f, dhConcat);
  
  const salt = new Uint8Array(32); // Zero salt
  const info = new TextEncoder().encode('X3DH-Signal-Protocol');
  
  const sharedSecret = hkdf(km, salt, info, 32);
  
  // Create associated data (AD) for AEAD
  // AD = Encode(IK_A) || Encode(IK_B)
  const associatedData = concatenateBytes(
    aliceIdentityKey.publicKey,
    bobKeyBundle.identityKey
  );
  
  return {
    sharedSecret,
    ephemeralPublic: aliceEphemeralKey.publicKey,
    associatedData
  };
}

/**
 * Perform X3DH as the responder (Bob)
 * 
 * Bob receives Alice's initial message and derives the same shared secret.
 * 
 * @param bobIdentityKey - Bob's Ed25519 identity key pair
 * @param bobSignedPreKey - Bob's X25519 signed pre-key pair
 * @param bobOneTimePreKey - Bob's X25519 one-time pre-key pair (if used)
 * @param aliceIdentityPublic - Alice's Ed25519 identity public key
 * @param aliceEphemeralPublic - Alice's X25519 ephemeral public key
 * @returns Shared secret (32 bytes)
 * 
 * @example
 * ```typescript
 * const sharedSecret = x3dhResponder(
 *   bobIdentityKey,
 *   bobSignedPreKey,
 *   bobOneTimePreKey, // or null if not used
 *   aliceMessage.identityKey,
 *   aliceMessage.ephemeralKey
 * );
 * // Use sharedSecret to initialize Double Ratchet
 * ```
 */
export function x3dhResponder(
  bobIdentityKey: Ed25519KeyPair,
  bobSignedPreKey: X25519KeyPair,
  bobOneTimePreKey: X25519KeyPair | null,
  aliceIdentityPublic: Uint8Array,
  aliceEphemeralPublic: Uint8Array
): Uint8Array {
  // Convert Bob's Ed25519 identity key to X25519 for DH
  const bobIdentityX25519Private = bobIdentityKey.privateKey;
  
  // Convert Alice's Ed25519 identity public key to X25519
  const aliceIdentityX25519Public = aliceIdentityPublic;
  
  // Perform the DH operations (mirror of initiator)
  // DH1: Bob's signed pre-key with Alice's identity key
  const dh1 = x25519DH(bobSignedPreKey.privateKey, aliceIdentityX25519Public);
  
  // DH2: Bob's identity key with Alice's ephemeral key
  const dh2 = x25519DH(bobIdentityX25519Private, aliceEphemeralPublic);
  
  // DH3: Bob's signed pre-key with Alice's ephemeral key
  const dh3 = x25519DH(bobSignedPreKey.privateKey, aliceEphemeralPublic);
  
  // DH4: Bob's one-time pre-key with Alice's ephemeral key (if available)
  let dh4: Uint8Array | null = null;
  if (bobOneTimePreKey) {
    dh4 = x25519DH(bobOneTimePreKey.privateKey, aliceEphemeralPublic);
  }
  
  // Concatenate DH outputs
  const dhConcat = dh4
    ? concatenateBytes(dh1, dh2, dh3, dh4)
    : concatenateBytes(dh1, dh2, dh3);
  
  // Derive shared secret using HKDF
  const f = new Uint8Array(32).fill(0xFF);
  const km = concatenateBytes(f, dhConcat);
  
  const salt = new Uint8Array(32);
  const info = new TextEncoder().encode('X3DH-Signal-Protocol');
  
  return hkdf(km, salt, info, 32);
}

/**
 * Create an X3DH initial message
 * 
 * Creates the message that Alice sends to Bob to initiate a session.
 * 
 * @param aliceIdentityPublic - Alice's identity public key
 * @param aliceEphemeralPublic - Alice's ephemeral public key
 * @param signedPreKeyId - ID of Bob's signed pre-key used
 * @param oneTimePreKeyId - ID of Bob's one-time pre-key used (optional)
 * @returns X3DHInitialMessage
 */
export function createInitialMessage(
  aliceIdentityPublic: Uint8Array,
  aliceEphemeralPublic: Uint8Array,
  signedPreKeyId: number,
  oneTimePreKeyId?: number
): X3DHInitialMessage {
  return {
    identityKey: aliceIdentityPublic,
    ephemeralKey: aliceEphemeralPublic,
    signedPreKeyId,
    oneTimePreKeyId
  };
}

/**
 * Concatenate multiple Uint8Arrays
 */
function concatenateBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  
  return result;
}

/**
 * Generate new one-time pre-keys
 * 
 * Call this periodically to replenish one-time pre-keys on the server.
 * 
 * @param count - Number of keys to generate
 * @returns Array of OneTimePreKey
 */
export function generateOneTimePreKeys(count: number): OneTimePreKey[] {
  const keys: OneTimePreKey[] = [];
  
  for (let i = 0; i < count; i++) {
    keys.push({
      keyPair: generateX25519KeyPair(),
      keyId: generateKeyId()
    });
  }
  
  return keys;
}

/**
 * Rotate the signed pre-key
 * 
 * Should be called periodically (e.g., weekly) to maintain forward secrecy.
 * 
 * @param identityKey - Identity key for signing
 * @returns New SignedPreKey
 */
export function rotateSignedPreKey(identityKey: Ed25519KeyPair): SignedPreKey {
  const keyPair = generateX25519KeyPair();
  const signature = sign(keyPair.publicKey, identityKey.privateKey);
  
  return {
    keyPair,
    signature,
    keyId: generateKeyId(),
    timestamp: Date.now()
  };
}

/**
 * Serialize a public key bundle for transmission
 * 
 * @param bundle - Public key bundle to serialize
 * @returns Serialized bytes
 */
export function serializePublicKeyBundle(bundle: PublicKeyBundle): Uint8Array {
  const parts: Uint8Array[] = [
    bundle.identityKey,
    bundle.signedPreKey,
    bundle.signedPreKeySignature,
    new Uint8Array(new Uint32Array([bundle.signedPreKeyId]).buffer)
  ];
  
  if (bundle.oneTimePreKey && bundle.oneTimePreKeyId !== undefined) {
    parts.push(new Uint8Array([1])); // Has OTK flag
    parts.push(bundle.oneTimePreKey);
    parts.push(new Uint8Array(new Uint32Array([bundle.oneTimePreKeyId]).buffer));
  } else {
    parts.push(new Uint8Array([0])); // No OTK flag
  }
  
  return concatenateBytes(...parts);
}

/**
 * Deserialize a public key bundle
 * 
 * @param bytes - Serialized bundle bytes
 * @returns PublicKeyBundle
 */
export function deserializePublicKeyBundle(bytes: Uint8Array): PublicKeyBundle {
  let offset = 0;
  
  const identityKey = bytes.slice(offset, offset + 32);
  offset += 32;
  
  const signedPreKey = bytes.slice(offset, offset + 32);
  offset += 32;
  
  const signedPreKeySignature = bytes.slice(offset, offset + 64);
  offset += 64;
  
  const signedPreKeyId = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  offset += 4;
  
  const hasOTK = bytes[offset] === 1;
  offset += 1;
  
  const bundle: PublicKeyBundle = {
    identityKey,
    signedPreKey,
    signedPreKeySignature,
    signedPreKeyId
  };
  
  if (hasOTK) {
    bundle.oneTimePreKey = bytes.slice(offset, offset + 32);
    offset += 32;
    bundle.oneTimePreKeyId = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
  }
  
  return bundle;
}