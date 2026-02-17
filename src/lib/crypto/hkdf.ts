// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * HKDF (HMAC-based Key Derivation Function) Implementation
 * 
 * Implements RFC 5869 HKDF using SHA-256 as the underlying hash function.
 * This is a critical component for the Signal Protocol's Double Ratchet Algorithm.
 * 
 * HKDF is used to derive cryptographically strong keys from input keying material (IKM).
 * It consists of two stages:
 * 1. Extract: Takes IKM and optional salt, produces a pseudorandom key (PRK)
 * 2. Expand: Takes PRK and optional info, produces output keying material (OKM)
 * 
 * @module crypto/hkdf
 */

import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';

/**
 * HKDF-Extract function
 * 
 * Extracts a pseudorandom key (PRK) from the input keying material (IKM) and salt.
 * This is the first stage of HKDF that concentrates the entropy of the IKM.
 * 
 * @param salt - Optional salt value (a non-secret random value). 
 *               If not provided, a string of HashLen zeros is used.
 * @param ikm - Input keying material (the secret input)
 * @returns PRK - A pseudorandom key of HashLen bytes (32 bytes for SHA-256)
 * 
 * @example
 * ```typescript
 * const salt = new Uint8Array(32); // 32 zero bytes
 * const ikm = new Uint8Array([1, 2, 3, 4, 5]); // Secret input
 * const prk = hkdfExtract(salt, ikm);
 * // prk is now a 32-byte pseudorandom key
 * ```
 */
export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Uint8Array {
  // If salt is empty, use a string of HashLen zeros
  const actualSalt = salt.length > 0 ? salt : new Uint8Array(32);
  
  // PRK = HMAC-Hash(salt, IKM)
  return hmac(sha256, actualSalt, ikm);
}

/**
 * HKDF-Expand function
 * 
 * Expands the pseudorandom key (PRK) into output keying material (OKM) of desired length.
 * This is the second stage of HKDF that produces the actual key material.
 * 
 * @param prk - Pseudorandom key (at least HashLen bytes, typically from hkdfExtract)
 * @param info - Optional context and application specific information (can be empty)
 * @param length - Length of output keying material in bytes (max 255 * HashLen)
 * @returns OKM - Output keying material of the specified length
 * 
 * @throws Error if length exceeds maximum allowed (255 * 32 = 8160 bytes for SHA-256)
 * 
 * @example
 * ```typescript
 * const prk = hkdfExtract(salt, ikm);
 * const info = new TextEncoder().encode("application-specific-info");
 * const okm = hkdfExpand(prk, info, 64); // Get 64 bytes of key material
 * ```
 */
export function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const hashLen = 32; // SHA-256 output length
  const maxLength = 255 * hashLen;
  
  if (length > maxLength) {
    throw new Error(`HKDF-Expand: requested length ${length} exceeds maximum ${maxLength}`);
  }
  
  if (prk.length < hashLen) {
    throw new Error(`HKDF-Expand: PRK must be at least ${hashLen} bytes`);
  }
  
  // Number of iterations needed
  const n = Math.ceil(length / hashLen);
  
  // Output keying material
  const okm = new Uint8Array(n * hashLen);
  
  // T(0) = empty string
  let t = new Uint8Array(0);
  
  for (let i = 1; i <= n; i++) {
    // T(i) = HMAC-Hash(PRK, T(i-1) | info | i)
    const input = new Uint8Array(t.length + info.length + 1);
    input.set(t, 0);
    input.set(info, t.length);
    input[t.length + info.length] = i;
    
    t = hmac(sha256, prk, input);
    okm.set(t, (i - 1) * hashLen);
  }
  
  // Return only the requested number of bytes
  return okm.slice(0, length);
}

/**
 * Complete HKDF function (Extract-then-Expand)
 * 
 * Combines both HKDF-Extract and HKDF-Expand into a single operation.
 * This is the standard way to use HKDF for key derivation.
 * 
 * @param ikm - Input keying material (the secret input)
 * @param salt - Optional salt value (a non-secret random value)
 * @param info - Optional context and application specific information
 * @param length - Length of output keying material in bytes
 * @returns OKM - Output keying material of the specified length
 * 
 * @example
 * ```typescript
 * const sharedSecret = performDH(myPrivateKey, theirPublicKey);
 * const salt = new Uint8Array(32);
 * const info = new TextEncoder().encode("Signal-Protocol-Key");
 * const derivedKey = hkdf(sharedSecret, salt, info, 32);
 * ```
 */
export function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  const prk = hkdfExtract(salt, ikm);
  return hkdfExpand(prk, info, length);
}

/**
 * Derive multiple keys from a single input using HKDF
 * 
 * This is a convenience function for deriving multiple keys at once,
 * which is common in the Double Ratchet Algorithm.
 * 
 * @param ikm - Input keying material
 * @param salt - Salt value
 * @param info - Context information
 * @param lengths - Array of lengths for each key to derive
 * @returns Array of derived keys
 * 
 * @example
 * ```typescript
 * const [rootKey, chainKey] = deriveKeys(
 *   sharedSecret,
 *   currentRootKey,
 *   new TextEncoder().encode("Signal-Ratchet"),
 *   [32, 32]
 * );
 * ```
 */
export function deriveKeys(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengths: number[]
): Uint8Array[] {
  const totalLength = lengths.reduce((a, b) => a + b, 0);
  const okm = hkdf(ikm, salt, info, totalLength);
  
  const keys: Uint8Array[] = [];
  let offset = 0;
  
  for (const length of lengths) {
    keys.push(okm.slice(offset, offset + length));
    offset += length;
  }
  
  return keys;
}

/**
 * KDF for the Double Ratchet root key chain
 * 
 * Derives a new root key and chain key from the current root key
 * and a DH output. This is used when performing a DH ratchet step.
 * 
 * @param rootKey - Current root key (32 bytes)
 * @param dhOutput - Output of DH key exchange (32 bytes)
 * @returns Tuple of [newRootKey, chainKey]
 * 
 * @example
 * ```typescript
 * const dhOutput = x25519.scalarMult(myPrivateKey, theirPublicKey);
 * const [newRootKey, chainKey] = kdfRK(currentRootKey, dhOutput);
 * ```
 */
export function kdfRK(rootKey: Uint8Array, dhOutput: Uint8Array): [Uint8Array, Uint8Array] {
  const info = new TextEncoder().encode('Signal-Double-Ratchet-RK');
  const output = hkdf(dhOutput, rootKey, info, 64);
  
  return [
    output.slice(0, 32),  // New root key
    output.slice(32, 64)  // Chain key
  ];
}

/**
 * KDF for the Double Ratchet chain key
 * 
 * Derives a new chain key and message key from the current chain key.
 * This is used for the symmetric ratchet step.
 * 
 * @param chainKey - Current chain key (32 bytes)
 * @returns Tuple of [newChainKey, messageKey]
 * 
 * @example
 * ```typescript
 * const [newChainKey, messageKey] = kdfCK(currentChainKey);
 * // Use messageKey to encrypt/decrypt a message
 * // Store newChainKey for the next message
 * ```
 */
export function kdfCK(chainKey: Uint8Array): [Uint8Array, Uint8Array] {
  // Message key constant: 0x01
  const messageKeyInput = new Uint8Array([0x01]);
  // Chain key constant: 0x02
  const chainKeyInput = new Uint8Array([0x02]);
  
  const messageKey = hmac(sha256, chainKey, messageKeyInput);
  const newChainKey = hmac(sha256, chainKey, chainKeyInput);
  
  return [newChainKey, messageKey];
}

/**
 * Derive encryption key and IV from a message key
 * 
 * Expands a message key into an encryption key and IV for AES-256-GCM.
 * 
 * @param messageKey - Message key (32 bytes)
 * @returns Object containing encryptionKey (32 bytes) and iv (12 bytes)
 * 
 * @example
 * ```typescript
 * const [_, messageKey] = kdfCK(chainKey);
 * const { encryptionKey, iv } = deriveMessageKeys(messageKey);
 * // Use encryptionKey and iv with AES-256-GCM
 * ```
 */
export function deriveMessageKeys(messageKey: Uint8Array): {
  encryptionKey: Uint8Array;
  iv: Uint8Array;
  authKey: Uint8Array;
} {
  const info = new TextEncoder().encode('Signal-Message-Keys');
  const salt = new Uint8Array(32); // Zero salt
  const output = hkdf(messageKey, salt, info, 80);
  
  return {
    encryptionKey: output.slice(0, 32),  // 32 bytes for AES-256
    authKey: output.slice(32, 64),        // 32 bytes for authentication
    iv: output.slice(64, 76)              // 12 bytes for GCM IV
  };
}

/**
 * Derive header encryption keys
 * 
 * Derives keys for encrypting message headers in the Double Ratchet.
 * 
 * @param chainKey - Chain key to derive from
 * @returns Object containing headerKey and headerIV
 */
export function deriveHeaderKeys(chainKey: Uint8Array): {
  headerKey: Uint8Array;
  headerIV: Uint8Array;
} {
  const info = new TextEncoder().encode('Signal-Header-Keys');
  const salt = new Uint8Array(32);
  const output = hkdf(chainKey, salt, info, 44);
  
  return {
    headerKey: output.slice(0, 32),
    headerIV: output.slice(32, 44)
  };
}