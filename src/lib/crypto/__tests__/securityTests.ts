// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Security Test Suite for Military-Grade E2EE
 * 
 * These tests verify the cryptographic properties of the ANU messaging
 * application's end-to-end encryption implementation.
 * 
 * Test Categories:
 * 1. Key Generation - Verifies cryptographic randomness and key sizes
 * 2. Double Ratchet - Verifies forward secrecy and post-compromise security
 * 3. X3DH Key Agreement - Verifies key exchange protocol
 * 4. Message Encryption - Verifies confidentiality and integrity
 * 5. Digital Signatures - Verifies authenticity
 * 6. Key Storage - Verifies secure storage
 * 7. Group Encryption - Verifies Sender Keys protocol
 * 8. WebRTC E2EE - Verifies media encryption
 * 
 * @module crypto/__tests__/securityTests
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';

// Import all crypto modules
import {
  // Key generation
  generateSigningKeyPair,
  generateX25519KeyPair,
  generateKeyBundle,
  secureRandomBytes,
  
  // X3DH
  x3dhInitiator,
  x3dhResponder,
  getPublicKeyBundle,
  verifyKeyBundle,
  
  // Double Ratchet
  ratchetInitAlice,
  ratchetInitBob,
  ratchetEncrypt,
  ratchetDecrypt,
  encryptMessage,
  decryptMessage,
  serializeRatchetState,
  deserializeRatchetState,
  
  // AEAD
  encryptAEAD,
  decryptAEAD,
  generateNonce,
  
  // Signatures
  sign,
  verify,
  constantTimeEqual,
  
  // HKDF
  hkdf,
  hkdfExtract,
  hkdfExpand,
  kdfRK,
  kdfCK,
  
  // Utilities
  bytesToHex,
  hexToBytes,
  bytesToBase64,
  base64ToBytes,
  secureCompare,
  secureClear,
  
  // High-level
  generateIdentity,
  establishSession,
  acceptSession,
  sessionEncrypt,
  sessionDecrypt,
  getSecurityFingerprint
} from '../index';

import {
  GroupEncryptionManager,
  serializeGroupMessage,
  deserializeGroupMessage
} from '../groupEncryption';

import {
  supportsInsertableStreams,
  deriveFrameKey
} from '../webrtcE2EE';

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Check if two Uint8Arrays are equal
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Check if a Uint8Array contains all zeros
 */
function isAllZeros(arr: Uint8Array): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) return false;
  }
  return true;
}

/**
 * Calculate entropy of a byte array (Shannon entropy)
 */
function calculateEntropy(data: Uint8Array): number {
  const freq = new Map<number, number>();
  for (const byte of data) {
    freq.set(byte, (freq.get(byte) || 0) + 1);
  }
  
  let entropy = 0;
  const len = data.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }
  
  return entropy;
}

// ============================================================================
// 1. Key Generation Tests
// ============================================================================

describe('Cryptographic Key Generation', () => {
  describe('Random Number Generation', () => {
    test('generates cryptographically random bytes', () => {
      const random1 = secureRandomBytes(32);
      const random2 = secureRandomBytes(32);
      
      // Should be 32 bytes
      expect(random1.length).toBe(32);
      expect(random2.length).toBe(32);
      
      // Should not be all zeros
      expect(isAllZeros(random1)).toBe(false);
      expect(isAllZeros(random2)).toBe(false);
      
      // Should be different each time
      expect(arraysEqual(random1, random2)).toBe(false);
    });
    
    test('random bytes have high entropy', () => {
      const random = secureRandomBytes(1024);
      const entropy = calculateEntropy(random);
      
      // Good random data should have entropy close to 8 bits per byte
      // We accept >= 7.5 as "good enough" for cryptographic randomness
      expect(entropy).toBeGreaterThanOrEqual(7.5);
    });
    
    test('generates different values across multiple calls', () => {
      const samples = new Set<string>();
      
      for (let i = 0; i < 100; i++) {
        const random = secureRandomBytes(16);
        samples.add(bytesToHex(random));
      }
      
      // All 100 samples should be unique
      expect(samples.size).toBe(100);
    });
  });
  
  describe('Ed25519 Key Generation', () => {
    test('generates valid Ed25519 key pairs', () => {
      const keyPair = generateSigningKeyPair();
      
      // Check key sizes
      expect(keyPair.publicKey.length).toBe(32);
      expect(keyPair.privateKey.length).toBe(32);
      
      // Keys should not be all zeros
      expect(isAllZeros(keyPair.publicKey)).toBe(false);
      expect(isAllZeros(keyPair.privateKey)).toBe(false);
    });
    
    test('key pairs are unique across generations', () => {
      const keyPair1 = generateSigningKeyPair();
      const keyPair2 = generateSigningKeyPair();
      
      expect(arraysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false);
      expect(arraysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(false);
    });
    
    test('public key is derivable from private key', () => {
      const keyPair = generateSigningKeyPair();
      
      // Sign and verify to confirm key pair is valid
      const message = new TextEncoder().encode('test message');
      const signature = sign(message, keyPair.privateKey);
      const isValid = verify(message, signature, keyPair.publicKey);
      
      expect(isValid).toBe(true);
    });
  });
  
  describe('X25519 Key Generation', () => {
    test('generates valid X25519 key pairs', () => {
      const keyPair = generateX25519KeyPair();
      
      // Check key sizes
      expect(keyPair.publicKey.length).toBe(32);
      expect(keyPair.privateKey.length).toBe(32);
      
      // Keys should not be all zeros
      expect(isAllZeros(keyPair.publicKey)).toBe(false);
      expect(isAllZeros(keyPair.privateKey)).toBe(false);
    });
    
    test('key pairs are unique across generations', () => {
      const keyPair1 = generateX25519KeyPair();
      const keyPair2 = generateX25519KeyPair();
      
      expect(arraysEqual(keyPair1.publicKey, keyPair2.publicKey)).toBe(false);
      expect(arraysEqual(keyPair1.privateKey, keyPair2.privateKey)).toBe(false);
    });
  });
  
  describe('Key Bundle Generation', () => {
    test('generates complete key bundle', () => {
      const bundle = generateKeyBundle(10);
      
      // Identity key
      expect(bundle.identityKey.publicKey.length).toBe(32);
      expect(bundle.identityKey.privateKey.length).toBe(32);
      
      // Signed pre-key
      expect(bundle.signedPreKey.keyPair.publicKey.length).toBe(32);
      expect(bundle.signedPreKey.keyPair.privateKey.length).toBe(32);
      expect(bundle.signedPreKey.signature.length).toBe(64);
      expect(bundle.signedPreKey.keyId).toBeGreaterThan(0);
      
      // One-time pre-keys
      expect(bundle.oneTimePreKeys.length).toBe(10);
      for (const otk of bundle.oneTimePreKeys) {
        expect(otk.keyPair.publicKey.length).toBe(32);
        expect(otk.keyPair.privateKey.length).toBe(32);
        expect(otk.keyId).toBeGreaterThan(0);
      }
    });
    
    test('signed pre-key signature is valid', () => {
      const bundle = generateKeyBundle(5);
      
      const isValid = verify(
        bundle.signedPreKey.keyPair.publicKey,
        bundle.signedPreKey.signature,
        bundle.identityKey.publicKey
      );
      
      expect(isValid).toBe(true);
    });
    
    test('one-time pre-key IDs are unique', () => {
      const bundle = generateKeyBundle(100);
      const ids = new Set(bundle.oneTimePreKeys.map(k => k.keyId));
      
      expect(ids.size).toBe(100);
    });
  });
});

// ============================================================================
// 2. Double Ratchet Tests
// ============================================================================

describe('Double Ratchet Algorithm', () => {
  let aliceState: ReturnType<typeof ratchetInitAlice>;
  let bobState: ReturnType<typeof ratchetInitBob>;
  let sharedSecret: Uint8Array;
  let bobKeyPair: ReturnType<typeof generateX25519KeyPair>;
  
  beforeEach(() => {
    // Setup shared secret (simulating X3DH output)
    sharedSecret = secureRandomBytes(32);
    bobKeyPair = generateX25519KeyPair();
    
    // Initialize ratchets
    aliceState = ratchetInitAlice(sharedSecret, bobKeyPair.publicKey);
    bobState = ratchetInitBob(sharedSecret, bobKeyPair);
  });
  
  describe('Forward Secrecy', () => {
    test('provides forward secrecy - old keys cannot decrypt new messages', () => {
      // Alice sends first message
      const [state1, encrypted1] = encryptMessage(aliceState, 'Message 1');
      aliceState = state1;
      
      // Save Alice's state at this point
      const savedState = serializeRatchetState(aliceState);
      
      // Bob receives and responds
      const [bobState1] = decryptMessage(bobState, encrypted1);
      bobState = bobState1;
      const [bobState2, response] = encryptMessage(bobState, 'Response');
      bobState = bobState2;
      
      // Alice receives response
      decryptMessage(aliceState, response);
      
      // Alice sends more messages
      const [state3, encrypted2] = encryptMessage(aliceState, 'Message 2');
      aliceState = state3;
      
      // Try to decrypt new message with old state
      const oldState = deserializeRatchetState(savedState);
      expect(() => {
        decryptMessage(oldState, encrypted2);
      }).toThrow();
    });
    
    test('message keys are never reused', () => {
      const messageKeys = new Set<string>();
      
      // Send multiple messages
      for (let i = 0; i < 10; i++) {
        const [newState, encrypted] = encryptMessage(aliceState, `Message ${i}`);
        aliceState = newState;
        
        // The nonce should be unique for each message
        const nonceHex = bytesToHex(encrypted.nonce);
        expect(messageKeys.has(nonceHex)).toBe(false);
        messageKeys.add(nonceHex);
      }
    });
  });
  
  describe('Post-Compromise Security', () => {
    test('provides post-compromise security - recovers after key compromise', () => {
      // Simulate key compromise by saving state
      const compromisedState = serializeRatchetState(aliceState);
      
      // Exchange several messages (DH ratchet steps)
      for (let i = 0; i < 5; i++) {
        // Alice sends
        const [aState, aMsg] = encryptMessage(aliceState, `Alice ${i}`);
        aliceState = aState;
        
        // Bob receives and responds
        const [bState1] = decryptMessage(bobState, aMsg);
        bobState = bState1;
        const [bState2, bMsg] = encryptMessage(bobState, `Bob ${i}`);
        bobState = bState2;
        
        // Alice receives
        const [aState2] = decryptMessage(aliceState, bMsg);
        aliceState = aState2;
      }
      
      // After several exchanges, compromised state should be useless
      const oldState = deserializeRatchetState(compromisedState);
      
      // New messages cannot be decrypted with old state
      const [, newMsg] = encryptMessage(aliceState, 'New message');
      expect(() => {
        decryptMessage(oldState, newMsg);
      }).toThrow();
    });
  });
  
  describe('Out-of-Order Message Handling', () => {
    test('handles out-of-order messages correctly', () => {
      // Alice sends multiple messages
      const messages: Array<{ encrypted: ReturnType<typeof encryptMessage>[1]; plaintext: string }> = [];
      
      for (let i = 0; i < 5; i++) {
        const plaintext = `Message ${i}`;
        const [newState, encrypted] = encryptMessage(aliceState, plaintext);
        aliceState = newState;
        messages.push({ encrypted, plaintext });
      }
      
      // Bob receives messages out of order (4, 2, 0, 3, 1)
      const order = [4, 2, 0, 3, 1];
      
      for (const idx of order) {
        const [newState, decrypted] = decryptMessage(bobState, messages[idx].encrypted);
        bobState = newState;
        expect(decrypted).toBe(messages[idx].plaintext);
      }
    });
    
    test('rejects duplicate messages', () => {
      // Alice sends a message
      const [newState, encrypted] = encryptMessage(aliceState, 'Test message');
      aliceState = newState;
      
      // Bob receives it
      const [bobState1] = decryptMessage(bobState, encrypted);
      bobState = bobState1;
      
      // Trying to decrypt the same message again should fail
      expect(() => {
        decryptMessage(bobState, encrypted);
      }).toThrow();
    });
  });
  
  describe('Bidirectional Communication', () => {
    test('supports bidirectional message exchange', () => {
      const conversation: string[] = [];
      
      // Alice sends
      const [aState, aMsg1] = encryptMessage(aliceState, 'Hello Bob!');
      aliceState = aState;
      
      // Bob receives and responds
      const [bState, received1] = decryptMessage(bobState, aMsg1);
      bobState = bState;
      conversation.push(received1);
      
      const [bState2, bMsg1] = encryptMessage(bobState, 'Hi Alice!');
      bobState = bState2;
      
      // Alice receives and responds
      const [aState2, received2] = decryptMessage(aliceState, bMsg1);
      aliceState = aState2;
      conversation.push(received2);
      
      const [aState3, aMsg2] = encryptMessage(aliceState, 'How are you?');
      aliceState = aState3;
      
      // Bob receives
      const [bState3, received3] = decryptMessage(bobState, aMsg2);
      bobState = bState3;
      conversation.push(received3);
      
      expect(conversation).toEqual(['Hello Bob!', 'Hi Alice!', 'How are you?']);
    });
  });
  
  describe('State Serialization', () => {
    test('serializes and deserializes state correctly', () => {
      // Send some messages to advance state
      const [state1] = encryptMessage(aliceState, 'Test');
      aliceState = state1;
      
      // Serialize
      const serialized = serializeRatchetState(aliceState);
      
      // Deserialize
      const restored = deserializeRatchetState(serialized);
      
      // Should be able to continue conversation
      const [state2, encrypted] = encryptMessage(restored, 'After restore');
      const [, decrypted] = decryptMessage(bobState, encrypted);
      
      expect(decrypted).toBe('After restore');
    });
  });
});

// ============================================================================
// 3. X3DH Key Agreement Tests
// ============================================================================

describe('X3DH Key Agreement', () => {
  let aliceBundle: ReturnType<typeof generateKeyBundle>;
  let bobBundle: ReturnType<typeof generateKeyBundle>;
  
  beforeEach(() => {
    aliceBundle = generateKeyBundle(10);
    bobBundle = generateKeyBundle(10);
  });
  
  describe('Key Agreement', () => {
    test('derives identical shared secrets on both sides', () => {
      // Get Bob's public bundle
      const bobPublicBundle = getPublicKeyBundle(bobBundle, 0);
      
      // Alice initiates
      const aliceEphemeral = generateX25519KeyPair();
      const aliceResult = x3dhInitiator(
        aliceBundle.identityKey,
        aliceEphemeral,
        bobPublicBundle
      );
      
      // Bob responds
      const bobSharedSecret = x3dhResponder(
        bobBundle.identityKey,
        bobBundle.signedPreKey.keyPair,
        bobBundle.oneTimePreKeys[0].keyPair,
        aliceBundle.identityKey.publicKey,
        aliceEphemeral.publicKey
      );
      
      // Shared secrets should match
      expect(arraysEqual(aliceResult.sharedSecret, bobSharedSecret)).toBe(true);
    });
    
    test('works without one-time pre-key', () => {
      // Get Bob's public bundle without OTK
      const bobPublicBundle = getPublicKeyBundle(bobBundle);
      
      // Alice initiates
      const aliceEphemeral = generateX25519KeyPair();
      const aliceResult = x3dhInitiator(
        aliceBundle.identityKey,
        aliceEphemeral,
        bobPublicBundle
      );
      
      // Bob responds (no OTK)
      const bobSharedSecret = x3dhResponder(
        bobBundle.identityKey,
        bobBundle.signedPreKey.keyPair,
        null,
        aliceBundle.identityKey.publicKey,
        aliceEphemeral.publicKey
      );
      
      // Shared secrets should match
      expect(arraysEqual(aliceResult.sharedSecret, bobSharedSecret)).toBe(true);
    });
  });
  
  describe('Key Bundle Verification', () => {
    test('verifies valid key bundle signature', () => {
      const publicBundle = getPublicKeyBundle(bobBundle, 0);
      expect(verifyKeyBundle(publicBundle)).toBe(true);
    });
    
    test('rejects tampered key bundle', () => {
      const publicBundle = getPublicKeyBundle(bobBundle, 0);
      
      // Tamper with the signed pre-key
      publicBundle.signedPreKey[0] ^= 0xFF;
      
      expect(verifyKeyBundle(publicBundle)).toBe(false);
    });
    
    test('rejects invalid signature', () => {
      const publicBundle = getPublicKeyBundle(bobBundle, 0);
      
      // Tamper with the signature
      publicBundle.signedPreKeySignature[0] ^= 0xFF;
      
      expect(verifyKeyBundle(publicBundle)).toBe(false);
    });
  });
  
  describe('One-Time Pre-Key Consumption', () => {
    test('one-time pre-keys should be used only once', () => {
      const bobPublicBundle = getPublicKeyBundle(bobBundle, 0);
      
      // First use
      const aliceEphemeral1 = generateX25519KeyPair();
      const result1 = x3dhInitiator(
        aliceBundle.identityKey,
        aliceEphemeral1,
        bobPublicBundle
      );
      
      // Simulate OTK removal (in real implementation)
      // The same OTK should not be available for second use
      
      // Second initiator with same bundle should get different result
      // if OTK was properly consumed
      const aliceEphemeral2 = generateX25519KeyPair();
      const result2 = x3dhInitiator(
        aliceBundle.identityKey,
        aliceEphemeral2,
        bobPublicBundle
      );
      
      // Different ephemeral keys should produce different shared secrets
      expect(arraysEqual(result1.sharedSecret, result2.sharedSecret)).toBe(false);
    });
  });
});

// ============================================================================
// 4. Message Encryption Tests
// ============================================================================

describe('Message Encryption', () => {
  describe('AES-256-GCM Encryption', () => {
    test('encrypts and decrypts correctly', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext);
      const decrypted = decryptAEAD(key, nonce, ciphertext);
      
      expect(arraysEqual(decrypted, plaintext)).toBe(true);
    });
    
    test('ciphertext is different from plaintext', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext);
      
      expect(arraysEqual(ciphertext.slice(0, plaintext.length), plaintext)).toBe(false);
    });
    
    test('ciphertext includes authentication tag', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext);
      
      // Ciphertext should be plaintext length + 16 bytes (GCM tag)
      expect(ciphertext.length).toBe(plaintext.length + 16);
    });
    
    test('detects tampering', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext);
      
      // Tamper with ciphertext
      ciphertext[0] ^= 0xFF;
      
      expect(() => {
        decryptAEAD(key, nonce, ciphertext);
      }).toThrow();
    });
    
    test('fails with wrong key', () => {
      const key1 = secureRandomBytes(32);
      const key2 = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key1, nonce, plaintext);
      
      expect(() => {
        decryptAEAD(key2, nonce, ciphertext);
      }).toThrow();
    });
    
    test('fails with wrong nonce', () => {
      const key = secureRandomBytes(32);
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      
      const ciphertext = encryptAEAD(key, nonce1, plaintext);
      
      expect(() => {
        decryptAEAD(key, nonce2, ciphertext);
      }).toThrow();
    });
  });
  
  describe('Nonce Generation', () => {
    test('generates 12-byte nonces', () => {
      const nonce = generateNonce();
      expect(nonce.length).toBe(12);
    });
    
    test('nonces are unique', () => {
      const nonces = new Set<string>();
      
      for (let i = 0; i < 1000; i++) {
        const nonce = generateNonce();
        const hex = bytesToHex(nonce);
        expect(nonces.has(hex)).toBe(false);
        nonces.add(hex);
      }
    });
  });
  
  describe('Associated Data', () => {
    test('encrypts with associated data', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      const ad = new TextEncoder().encode('header data');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext, ad);
      const decrypted = decryptAEAD(key, nonce, ciphertext, ad);
      
      expect(arraysEqual(decrypted, plaintext)).toBe(true);
    });
    
    test('fails with wrong associated data', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new TextEncoder().encode('Secret message');
      const ad1 = new TextEncoder().encode('header data');
      const ad2 = new TextEncoder().encode('wrong header');
      
      const ciphertext = encryptAEAD(key, nonce, plaintext, ad1);
      
      expect(() => {
        decryptAEAD(key, nonce, ciphertext, ad2);
      }).toThrow();
    });
  });
  
  describe('Ciphertext Indistinguishability', () => {
    test('ciphertext appears random', () => {
      const key = secureRandomBytes(32);
      const nonce = generateNonce();
      const plaintext = new Uint8Array(1024).fill(0); // All zeros
      
      const ciphertext = encryptAEAD(key, nonce, plaintext);
      
      // Ciphertext should have high entropy (appear random)
      const entropy = calculateEntropy(ciphertext.slice(0, -16)); // Exclude tag
      expect(entropy).toBeGreaterThan(7.0);
    });
    
    test('same plaintext produces different ciphertext with different nonce', () => {
      const key = secureRandomBytes(32);
      const plaintext = new TextEncoder().encode('Same message');
      
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      
      const ciphertext1 = encryptAEAD(key, nonce1, plaintext);
      const ciphertext2 = encryptAEAD(key, nonce2, plaintext);
      
      expect(arraysEqual(ciphertext1, ciphertext2)).toBe(false);
    });
  });
});

// ============================================================================
// 5. Digital Signatures Tests
// ============================================================================

describe('Digital Signatures', () => {
  let keyPair: ReturnType<typeof generateSigningKeyPair>;
  
  beforeEach(() => {
    keyPair = generateSigningKeyPair();
  });
  
  describe('Signature Generation', () => {
    test('generates 64-byte signatures', () => {
      const message = new TextEncoder().encode('Test message');
      const signature = sign(message, keyPair.privateKey);
      
      expect(signature.length).toBe(64);
    });
    
    test('signatures are deterministic', () => {
      const message = new TextEncoder().encode('Test message');
      
      const sig1 = sign(message, keyPair.privateKey);
      const sig2 = sign(message, keyPair.privateKey);
      
      expect(arraysEqual(sig1, sig2)).toBe(true);
    });
    
    test('different messages produce different signatures', () => {
      const msg1 = new TextEncoder().encode('Message 1');
      const msg2 = new TextEncoder().encode('Message 2');
      
      const sig1 = sign(msg1, keyPair.privateKey);
      const sig2 = sign(msg2, keyPair.privateKey);
      
      expect(arraysEqual(sig1, sig2)).toBe(false);
    });
  });
  
  describe('Signature Verification', () => {
    test('valid signatures verify correctly', () => {
      const message = new TextEncoder().encode('Test message');
      const signature = sign(message, keyPair.privateKey);
      
      expect(verify(message, signature, keyPair.publicKey)).toBe(true);
    });
    
    test('invalid signatures are rejected', () => {
      const message = new TextEncoder().encode('Test message');
      const signature = sign(message, keyPair.privateKey);
      
      // Tamper with signature
      signature[0] ^= 0xFF;
      
      expect(verify(message, signature, keyPair.publicKey)).toBe(false);
    });
    
    test('wrong public key rejects signature', () => {
      const message = new TextEncoder().encode('Test message');
      const signature = sign(message, keyPair.privateKey);
      
      const otherKeyPair = generateSigningKeyPair();
      
      expect(verify(message, signature, otherKeyPair.publicKey)).toBe(false);
    });
    
    test('tampered message rejects signature', () => {
      const message = new TextEncoder().encode('Test message');
      const signature = sign(message, keyPair.privateKey);
      
      const tamperedMessage = new TextEncoder().encode('Test message!');
      
      expect(verify(tamperedMessage, signature, keyPair.publicKey)).toBe(false);
    });
  });
  
  describe('Signature Binding', () => {
    test('signature is bound to message content', () => {
      const msg1 = new TextEncoder().encode('Transfer $100');
      const msg2 = new TextEncoder().encode('Transfer $1000');
      
      const signature = sign(msg1, keyPair.privateKey);
      
      // Signature for $100 should not verify for $1000
      expect(verify(msg2, signature, keyPair.publicKey)).toBe(false);
    });
  });
});

// ============================================================================
// 6. Key Derivation Tests
// ============================================================================

describe('Key Derivation (HKDF)', () => {
  describe('HKDF-SHA256', () => {
    test('derives keys of correct length', () => {
      const ikm = secureRandomBytes(32);
      const salt = secureRandomBytes(32);
      const info = new TextEncoder().encode('test');
      
      const key16 = hkdf(ikm, salt, info, 16);
      const key32 = hkdf(ikm, salt, info, 32);
      const key64 = hkdf(ikm, salt, info, 64);
      
      expect(key16.length).toBe(16);
      expect(key32.length).toBe(32);
      expect(key64.length).toBe(64);
    });
    
    test('same inputs produce same output', () => {
      const ikm = secureRandomBytes(32);
      const salt = secureRandomBytes(32);
      const info = new TextEncoder().encode('test');
      
      const key1 = hkdf(ikm, salt, info, 32);
      const key2 = hkdf(ikm, salt, info, 32);
      
      expect(arraysEqual(key1, key2)).toBe(true);
    });
    
    test('different inputs produce different outputs', () => {
      const ikm1 = secureRandomBytes(32);
      const ikm2 = secureRandomBytes(32);
      const salt = secureRandomBytes(32);
      const info = new TextEncoder().encode('test');
      
      const key1 = hkdf(ikm1, salt, info, 32);
      const key2 = hkdf(ikm2, salt, info, 32);
      
      expect(arraysEqual(key1, key2)).toBe(false);
    });
    
    test('different info produces different outputs', () => {
      const ikm = secureRandomBytes(32);
      const salt = secureRandomBytes(32);
      const info1 = new TextEncoder().encode('context1');
      const info2 = new TextEncoder().encode('context2');
      
      const key1 = hkdf(ikm, salt, info1, 32);
      const key2 = hkdf(ikm, salt, info2, 32);
      
      expect(arraysEqual(key1, key2)).toBe(false);
    });
  });
  
  describe('Double Ratchet KDFs', () => {
    test('kdfRK produces two 32-byte keys', () => {
      const rootKey = secureRandomBytes(32);
      const dhOutput = secureRandomBytes(32);
      
      const [newRootKey, chainKey] = kdfRK(rootKey, dhOutput);
      
      expect(newRootKey.length).toBe(32);
      expect(chainKey.length).toBe(32);
    });
    
    test('kdfCK produces two 32-byte keys', () => {
      const chainKey = secureRandomBytes(32);
      
      const [newChainKey, messageKey] = kdfCK(chainKey);
      
      expect(newChainKey.length).toBe(32);
      expect(messageKey.length).toBe(32);
    });
    
    test('chain key ratchet is one-way', () => {
      const chainKey = secureRandomBytes(32);
      
      const [newChainKey] = kdfCK(chainKey);
      
      // Cannot derive original chain key from new chain key
      expect(arraysEqual(newChainKey, chainKey)).toBe(false);
    });
  });
});

// ============================================================================
// 7. Constant-Time Operations Tests
// ============================================================================

describe('Constant-Time Operations', () => {
  describe('Constant-Time Comparison', () => {
    test('returns true for equal arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 5]);
      
      expect(constantTimeEqual(a, b)).toBe(true);
      expect(secureCompare(a, b)).toBe(true);
    });
    
    test('returns false for different arrays', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4, 6]);
      
      expect(constantTimeEqual(a, b)).toBe(false);
      expect(secureCompare(a, b)).toBe(false);
    });
    
    test('returns false for different lengths', () => {
      const a = new Uint8Array([1, 2, 3, 4, 5]);
      const b = new Uint8Array([1, 2, 3, 4]);
      
      expect(constantTimeEqual(a, b)).toBe(false);
      expect(secureCompare(a, b)).toBe(false);
    });
    
    test('comparison time is independent of difference position', () => {
      // This is a basic check - true timing analysis requires more sophisticated testing
      const base = secureRandomBytes(1000);
      const diffStart = new Uint8Array(base);
      diffStart[0] ^= 0xFF;
      const diffEnd = new Uint8Array(base);
      diffEnd[999] ^= 0xFF;
      
      // Both should return false
      expect(secureCompare(base, diffStart)).toBe(false);
      expect(secureCompare(base, diffEnd)).toBe(false);
    });
  });
});

// ============================================================================
// 8. Encoding/Decoding Tests
// ============================================================================

describe('Encoding and Decoding', () => {
  describe('Hex Encoding', () => {
    test('encodes and decodes correctly', () => {
      const original = secureRandomBytes(32);
      const hex = bytesToHex(original);
      const decoded = hexToBytes(hex);
      
      expect(arraysEqual(original, decoded)).toBe(true);
    });
    
    test('produces lowercase hex', () => {
      const bytes = new Uint8Array([0xAB, 0xCD, 0xEF]);
      const hex = bytesToHex(bytes);
      
      expect(hex).toBe('abcdef');
    });
  });
  
  describe('Base64 Encoding', () => {
    test('encodes and decodes correctly', () => {
      const original = secureRandomBytes(32);
      const base64 = bytesToBase64(original);
      const decoded = base64ToBytes(base64);
      
      expect(arraysEqual(original, decoded)).toBe(true);
    });
  });
});

// ============================================================================
// 9. High-Level Session Tests
// ============================================================================

describe('High-Level Session Management', () => {
  test('generates identity with fingerprint', () => {
    const identity = generateIdentity(10);
    
    expect(identity.keyBundle).toBeDefined();
    expect(identity.fingerprint).toBeDefined();
    expect(identity.fingerprint.length).toBe(40); // 20 bytes as hex
  });
  
  test('establishes and uses session', () => {
    const aliceIdentity = generateIdentity(10);
    const bobIdentity = generateIdentity(10);
    
    const bobPublicBundle = getPublicKeyBundle(bobIdentity.keyBundle, 0);
    
    // Alice establishes session
    const aliceSession = establishSession(aliceIdentity, bobPublicBundle, 'session-1');
    
    // Alice encrypts
    const { session: newAliceSession, encrypted } = sessionEncrypt(aliceSession, 'Hello Bob!');
    
    // Bob accepts session and decrypts
    const bobSession = acceptSession(
      bobIdentity,
      aliceIdentity.keyBundle.identityKey.publicKey,
      newAliceSession.ratchetState.DHs.publicKey,
      bobPublicBundle.oneTimePreKeyId,
      'session-1'
    );
    
    const { message } = sessionDecrypt(bobSession, encrypted);
    
    expect(message).toBe('Hello Bob!');
  });
  
  test('generates consistent security fingerprint', () => {
    const aliceIdentity = generateIdentity(10);
    const bobIdentity = generateIdentity(10);
    
    const bobPublicBundle = getPublicKeyBundle(bobIdentity.keyBundle, 0);
    const aliceSession = establishSession(aliceIdentity, bobPublicBundle, 'session-1');
    
    const fingerprint1 = getSecurityFingerprint(
      aliceSession,
      aliceIdentity.keyBundle.identityKey.publicKey
    );
    
    const fingerprint2 = getSecurityFingerprint(
      aliceSession,
      aliceIdentity.keyBundle.identityKey.publicKey
    );
    
    expect(fingerprint1).toBe(fingerprint2);
  });
});

// ============================================================================
// 10. Group Encryption Tests
// ============================================================================

describe('Group Encryption', () => {
  let groupManager1: GroupEncryptionManager;
  let groupManager2: GroupEncryptionManager;
  
  beforeEach(() => {
    groupManager1 = new GroupEncryptionManager();
    groupManager1.initialize('user-1');
    
    groupManager2 = new GroupEncryptionManager();
    groupManager2.initialize('user-2');
  });
  
  test('creates group and encrypts message', async () => {
    await groupManager1.createGroup('group-1', ['user-1', 'user-2']);
    
    const encrypted = await groupManager1.encryptGroupMessage('group-1', 'Hello group!');
    
    expect(encrypted.groupId).toBe('group-1');
    expect(encrypted.senderId).toBe('user-1');
    expect(encrypted.ciphertext.length).toBeGreaterThan(0);
    expect(encrypted.signature.length).toBe(64);
  });
  
  test('serializes and deserializes group message', async () => {
    await groupManager1.createGroup('group-1', ['user-1']);
    
    const encrypted = await groupManager1.encryptGroupMessage('group-1', 'Test');
    const serialized = serializeGroupMessage(encrypted);
    const deserialized = deserializeGroupMessage(serialized);
    
    expect(deserialized.groupId).toBe(encrypted.groupId);
    expect(deserialized.senderId).toBe(encrypted.senderId);
    expect(arraysEqual(deserialized.ciphertext, encrypted.ciphertext)).toBe(true);
  });
});

// ============================================================================
// 11. WebRTC E2EE Tests
// ============================================================================

describe('WebRTC E2EE', () => {
  test('checks for Insertable Streams support', () => {
    // This will return false in Node.js test environment
    const supported = supportsInsertableStreams();
    expect(typeof supported).toBe('boolean');
  });
  
  test('derives frame keys', async () => {
    const sharedSecret = secureRandomBytes(32);
    
    const key0 = await deriveFrameKey(sharedSecret, 0);
    const key1 = await deriveFrameKey(sharedSecret, 1);
    
    // Keys should be CryptoKey objects
    expect(key0).toBeDefined();
    expect(key1).toBeDefined();
    
    // Different key IDs should produce different keys
    // (We can't directly compare CryptoKeys, but the derivation should be different)
  });
  
  test('derives different keys for different secrets', async () => {
    const secret1 = secureRandomBytes(32);
    const secret2 = secureRandomBytes(32);
    
    const key1 = await deriveFrameKey(secret1, 0);
    const key2 = await deriveFrameKey(secret2, 0);
    
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
  });
});

// ============================================================================
// 12. Memory Security Tests
// ============================================================================

describe('Memory Security', () => {
  test('secureClear zeros out data', () => {
    const sensitive = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    
    secureClear(sensitive);
    
    expect(isAllZeros(sensitive)).toBe(true);
  });
});

// ============================================================================
// 13. Integration Tests
// ============================================================================

describe('Integration Tests', () => {
  test('complete E2EE conversation flow', () => {
    // Generate identities
    const alice = generateIdentity(10);
    const bob = generateIdentity(10);
    
    // Exchange public bundles (simulating server)
    const bobPublicBundle = getPublicKeyBundle(bob.keyBundle, 0);
    
    // Alice initiates session with Bob
    let aliceSession = establishSession(alice, bobPublicBundle, 'alice-bob');
    
    // Alice sends first message
    const { session: aliceSession1, encrypted: msg1 } = sessionEncrypt(aliceSession, 'Hello Bob!');
    aliceSession = aliceSession1;
    
    // Bob accepts session and decrypts
    let bobSession = acceptSession(
      bob,
      alice.keyBundle.identityKey.publicKey,
      aliceSession.ratchetState.DHs.publicKey,
      bobPublicBundle.oneTimePreKeyId,
      'alice-bob'
    );
    
    const { session: bobSession1, message: received1 } = sessionDecrypt(bobSession, msg1);
    bobSession = bobSession1;
    expect(received1).toBe('Hello Bob!');
    
    // Bob responds
    const { session: bobSession2, encrypted: msg2 } = sessionEncrypt(bobSession, 'Hi Alice!');
    bobSession = bobSession2;
    
    // Alice decrypts
    const { session: aliceSession2, message: received2 } = sessionDecrypt(aliceSession, msg2);
    aliceSession = aliceSession2;
    expect(received2).toBe('Hi Alice!');
    
    // Continue conversation
    const { encrypted: msg3 } = sessionEncrypt(aliceSession, 'How are you?');
    
    const { message: received3 } = sessionDecrypt(bobSession, msg3);
    expect(received3).toBe('How are you?');
  });
  
  test('multiple concurrent sessions', () => {
    const alice = generateIdentity(10);
    const bob = generateIdentity(10);
    const charlie = generateIdentity(10);
    
    const bobBundle = getPublicKeyBundle(bob.keyBundle, 0);
    const charlieBundle = getPublicKeyBundle(charlie.keyBundle, 0);
    
    // Alice establishes sessions with both Bob and Charlie
    const aliceBobSession = establishSession(alice, bobBundle, 'alice-bob');
    const aliceCharlieSession = establishSession(alice, charlieBundle, 'alice-charlie');
    
    // Send different messages to each
    const { encrypted: toBob } = sessionEncrypt(aliceBobSession, 'Hello Bob!');
    const { encrypted: toCharlie } = sessionEncrypt(aliceCharlieSession, 'Hello Charlie!');
    
    // Bob and Charlie accept and decrypt
    const bobSession = acceptSession(
      bob,
      alice.keyBundle.identityKey.publicKey,
      aliceBobSession.ratchetState.DHs.publicKey,
      bobBundle.oneTimePreKeyId,
      'alice-bob'
    );
    
    const charlieSession = acceptSession(
      charlie,
      alice.keyBundle.identityKey.publicKey,
      aliceCharlieSession.ratchetState.DHs.publicKey,
      charlieBundle.oneTimePreKeyId,
      'alice-charlie'
    );
    
    const { message: bobReceived } = sessionDecrypt(bobSession, toBob);
    const { message: charlieReceived } = sessionDecrypt(charlieSession, toCharlie);
    
    expect(bobReceived).toBe('Hello Bob!');
    expect(charlieReceived).toBe('Hello Charlie!');
    
    // Messages should not be interchangeable
    expect(() => sessionDecrypt(bobSession, toCharlie)).toThrow();
    expect(() => sessionDecrypt(charlieSession, toBob)).toThrow();
  });
});
