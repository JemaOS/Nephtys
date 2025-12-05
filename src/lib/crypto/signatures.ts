// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Ed25519 Digital Signatures Implementation
 * 
 * Implements Ed25519 digital signatures using the @noble/curves library.
 * Ed25519 is a high-security, high-performance signature scheme used in
 * the Signal Protocol for signing pre-keys and verifying identity.
 * 
 * Key properties of Ed25519:
 * - 128-bit security level
 * - 64-byte signatures
 * - 32-byte public keys
 * - 32-byte private keys (seed)
 * - Deterministic signatures (same message + key = same signature)
 * - Fast verification
 * 
 * @module crypto/signatures
 */

import { ed25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';

/**
 * Ed25519 Key Pair interface
 */
export interface Ed25519KeyPair {
  /** Public key (32 bytes) */
  publicKey: Uint8Array;
  /** Private key / seed (32 bytes) */
  privateKey: Uint8Array;
}

/**
 * Signed data with signature attached
 */
export interface SignedData {
  /** Original data that was signed */
  data: Uint8Array;
  /** Ed25519 signature (64 bytes) */
  signature: Uint8Array;
  /** Public key of the signer (32 bytes) */
  signerPublicKey: Uint8Array;
}

/**
 * Generate a new Ed25519 signing key pair
 * 
 * Creates a cryptographically secure random key pair for digital signatures.
 * The private key is a 32-byte seed, and the public key is derived from it.
 * 
 * @returns Ed25519KeyPair containing publicKey and privateKey
 * 
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * console.log('Public key:', keyPair.publicKey); // 32 bytes
 * console.log('Private key:', keyPair.privateKey); // 32 bytes
 * ```
 */
export function generateSigningKeyPair(): Ed25519KeyPair {
  // Generate 32 random bytes as the private key seed
  const privateKey = randomBytes(32);
  
  // Derive the public key from the private key
  const publicKey = ed25519.getPublicKey(privateKey);
  
  return {
    publicKey,
    privateKey
  };
}

/**
 * Sign a message using Ed25519
 * 
 * Creates a deterministic signature for the given message using the private key.
 * The same message and key will always produce the same signature.
 * 
 * @param message - The message to sign (arbitrary length)
 * @param privateKey - The 32-byte Ed25519 private key (seed)
 * @returns 64-byte Ed25519 signature
 * 
 * @throws Error if the private key is invalid
 * 
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * const message = new TextEncoder().encode("Hello, World!");
 * const signature = sign(message, keyPair.privateKey);
 * console.log('Signature:', signature); // 64 bytes
 * ```
 */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  if (privateKey.length !== 32) {
    throw new Error('Ed25519 private key must be 32 bytes');
  }
  
  return ed25519.sign(message, privateKey);
}

/**
 * Verify an Ed25519 signature
 * 
 * Verifies that a signature was created by the holder of the private key
 * corresponding to the given public key.
 * 
 * @param message - The original message that was signed
 * @param signature - The 64-byte Ed25519 signature to verify
 * @param publicKey - The 32-byte Ed25519 public key of the signer
 * @returns true if the signature is valid, false otherwise
 * 
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * const message = new TextEncoder().encode("Hello, World!");
 * const signature = sign(message, keyPair.privateKey);
 * 
 * const isValid = verify(message, signature, keyPair.publicKey);
 * console.log('Signature valid:', isValid); // true
 * 
 * // Tampered message
 * const tamperedMessage = new TextEncoder().encode("Hello, World?");
 * const isValidTampered = verify(tamperedMessage, signature, keyPair.publicKey);
 * console.log('Tampered valid:', isValidTampered); // false
 * ```
 */
export function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (publicKey.length !== 32) {
    throw new Error('Ed25519 public key must be 32 bytes');
  }
  
  if (signature.length !== 64) {
    throw new Error('Ed25519 signature must be 64 bytes');
  }
  
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    // Invalid signature format or other error
    return false;
  }
}

/**
 * Sign data and return a SignedData object
 * 
 * Convenience function that signs data and packages it with the signature
 * and signer's public key for easy transmission and verification.
 * 
 * @param data - The data to sign
 * @param keyPair - The signer's key pair
 * @returns SignedData object containing data, signature, and public key
 * 
 * @example
 * ```typescript
 * const keyPair = generateSigningKeyPair();
 * const data = new TextEncoder().encode("Important message");
 * const signedData = signData(data, keyPair);
 * 
 * // Send signedData to recipient...
 * // Recipient can verify with verifySignedData(signedData)
 * ```
 */
export function signData(data: Uint8Array, keyPair: Ed25519KeyPair): SignedData {
  const signature = sign(data, keyPair.privateKey);
  
  return {
    data,
    signature,
    signerPublicKey: keyPair.publicKey
  };
}

/**
 * Verify a SignedData object
 * 
 * Verifies the signature in a SignedData object using the included public key.
 * 
 * @param signedData - The SignedData object to verify
 * @returns true if the signature is valid, false otherwise
 * 
 * @example
 * ```typescript
 * const signedData = signData(data, keyPair);
 * const isValid = verifySignedData(signedData);
 * if (isValid) {
 *   console.log('Data is authentic');
 * }
 * ```
 */
export function verifySignedData(signedData: SignedData): boolean {
  return verify(signedData.data, signedData.signature, signedData.signerPublicKey);
}

/**
 * Verify a SignedData object against a known public key
 * 
 * Verifies the signature and ensures it was created by a specific signer.
 * This is more secure than verifySignedData when you know the expected signer.
 * 
 * @param signedData - The SignedData object to verify
 * @param expectedPublicKey - The expected signer's public key
 * @returns true if signature is valid AND signer matches, false otherwise
 * 
 * @example
 * ```typescript
 * const aliceKeyPair = generateSigningKeyPair();
 * const signedData = signData(data, aliceKeyPair);
 * 
 * // Verify it's from Alice
 * const isFromAlice = verifySignedDataFrom(signedData, aliceKeyPair.publicKey);
 * ```
 */
export function verifySignedDataFrom(
  signedData: SignedData,
  expectedPublicKey: Uint8Array
): boolean {
  // First check if the public key matches
  if (!constantTimeEqual(signedData.signerPublicKey, expectedPublicKey)) {
    return false;
  }
  
  // Then verify the signature
  return verify(signedData.data, signedData.signature, expectedPublicKey);
}

/**
 * Constant-time comparison of two byte arrays
 * 
 * Prevents timing attacks by always comparing all bytes regardless of
 * where a mismatch occurs.
 * 
 * @param a - First byte array
 * @param b - Second byte array
 * @returns true if arrays are equal, false otherwise
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  
  return result === 0;
}

/**
 * Convert Ed25519 public key to X25519 public key
 * 
 * Ed25519 and X25519 use different curve representations.
 * This function converts an Ed25519 public key to its X25519 equivalent
 * for use in key exchange operations.
 * 
 * Note: This is a one-way conversion. The Signal Protocol uses separate
 * key pairs for signing (Ed25519) and key exchange (X25519).
 * 
 * @param ed25519PublicKey - Ed25519 public key (32 bytes)
 * @returns X25519 public key (32 bytes)
 */
export function ed25519PublicKeyToX25519(ed25519PublicKey: Uint8Array): Uint8Array {
  // The @noble/curves library provides this conversion
  // Ed25519 point to Montgomery (X25519) point conversion
  const point = ed25519.ExtendedPoint.fromHex(ed25519PublicKey);
  
  // Convert to Montgomery form (X25519)
  // u = (1 + y) / (1 - y) mod p
  const { y } = point.toAffine();
  const one = BigInt(1);
  const p = BigInt('57896044618658097711785492504343953926634992332820282019728792003956564819949');
  
  // Calculate u = (1 + y) * inverse(1 - y) mod p
  const numerator = mod(one + y, p);
  const denominator = mod(one - y, p);
  const u = mod(numerator * modInverse(denominator, p), p);
  
  // Convert to bytes (little-endian)
  return bigIntToBytes(u, 32);
}

/**
 * Modular arithmetic helper
 */
function mod(n: bigint, p: bigint): bigint {
  const result = n % p;
  return result >= 0n ? result : result + p;
}

/**
 * Modular multiplicative inverse using extended Euclidean algorithm
 */
function modInverse(a: bigint, p: bigint): bigint {
  let [old_r, r] = [a, p];
  let [old_s, s] = [1n, 0n];
  
  while (r !== 0n) {
    const quotient = old_r / r;
    [old_r, r] = [r, old_r - quotient * r];
    [old_s, s] = [s, old_s - quotient * s];
  }
  
  return mod(old_s, p);
}

/**
 * Convert BigInt to Uint8Array (little-endian)
 */
function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = n;
  
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  
  return bytes;
}

/**
 * Serialize an Ed25519 key pair to bytes
 * 
 * @param keyPair - The key pair to serialize
 * @returns 64-byte array (32 bytes private + 32 bytes public)
 */
export function serializeKeyPair(keyPair: Ed25519KeyPair): Uint8Array {
  const serialized = new Uint8Array(64);
  serialized.set(keyPair.privateKey, 0);
  serialized.set(keyPair.publicKey, 32);
  return serialized;
}

/**
 * Deserialize an Ed25519 key pair from bytes
 * 
 * @param bytes - 64-byte array containing the serialized key pair
 * @returns Ed25519KeyPair
 */
export function deserializeKeyPair(bytes: Uint8Array): Ed25519KeyPair {
  if (bytes.length !== 64) {
    throw new Error('Serialized key pair must be 64 bytes');
  }
  
  return {
    privateKey: bytes.slice(0, 32),
    publicKey: bytes.slice(32, 64)
  };
}

/**
 * Generate a signature for a pre-key (used in X3DH)
 * 
 * Signs a pre-key public key with the identity key to prove ownership.
 * This is used in the X3DH protocol to sign the signed pre-key.
 * 
 * @param preKeyPublic - The pre-key public key to sign (32 bytes)
 * @param identityPrivateKey - The identity private key for signing
 * @returns 64-byte signature
 * 
 * @example
 * ```typescript
 * const identityKey = generateSigningKeyPair();
 * const preKey = generateX25519KeyPair(); // From x3dh.ts
 * const signature = signPreKey(preKey.publicKey, identityKey.privateKey);
 * ```
 */
export function signPreKey(
  preKeyPublic: Uint8Array,
  identityPrivateKey: Uint8Array
): Uint8Array {
  return sign(preKeyPublic, identityPrivateKey);
}

/**
 * Verify a pre-key signature
 * 
 * Verifies that a pre-key was signed by the claimed identity.
 * 
 * @param preKeyPublic - The pre-key public key that was signed
 * @param signature - The signature to verify
 * @param identityPublicKey - The identity public key of the claimed signer
 * @returns true if the signature is valid
 */
export function verifyPreKeySignature(
  preKeyPublic: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array
): boolean {
  return verify(preKeyPublic, signature, identityPublicKey);
}