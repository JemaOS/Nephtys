// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * @deprecated This module uses P-256 ECDH which is not military-grade.
 * Use the new crypto modules in ./crypto/ instead:
 * - import { E2EEMessagingService, getMessagingService } from './crypto/messagingService'
 * - import { GroupEncryptionManager, getGroupEncryptionManager } from './crypto/groupEncryption'
 *
 * The new crypto modules provide:
 * - X25519 for key exchange (Curve25519)
 * - Ed25519 for digital signatures
 * - Double Ratchet Algorithm for Perfect Forward Secrecy
 * - X3DH for asynchronous key agreement
 * - Sender Keys protocol for efficient group encryption
 *
 * This module is kept for backward compatibility with existing encrypted messages.
 * New messages should use the military-grade E2EE system.
 *
 * Migration guide:
 * 1. Import the migration utility: import { migrateToMilitaryGradeE2EE } from './crypto/migration'
 * 2. Call migrateToMilitaryGradeE2EE() to generate new keys
 * 3. Notify contacts of key change
 * 4. Use the new E2EEMessagingService for all new messages
 *
 * @module encryption
 */

// End-to-End Encryption (E2EE) - Legacy Version (P-256 ECDH)
// Utilise Web Crypto API pour le chiffrement AES-GCM
// DEPRECATED: Use ./crypto/messagingService.ts instead

/**
 * @deprecated Use E2EEMessagingService from ./crypto/messagingService instead
 */
export class E2EEManager {
  private keyPair: CryptoKeyPair | null = null;
  private readonly sharedKeys: Map<string, CryptoKey> = new Map();

  // Générer une paire de clés (publique/privée)
  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    try {
      this.keyPair = await globalThis.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits']
      );

      // Exporter les clés
      const publicKeyBuffer = await globalThis.crypto.subtle.exportKey('spki', this.keyPair.publicKey);
      const privateKeyBuffer = await globalThis.crypto.subtle.exportKey('pkcs8', this.keyPair.privateKey);

      return {
        publicKey: this.arrayBufferToBase64(publicKeyBuffer),
        privateKey: this.arrayBufferToBase64(privateKeyBuffer),
      };
    } catch (error) {
      console.error('Error generating key pair:', error);
      throw error;
    }
  }

  // Importer une clé publique
  async importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
    const publicKeyBuffer = this.base64ToArrayBuffer(publicKeyBase64);
    return await globalThis.crypto.subtle.importKey(
      'spki',
      publicKeyBuffer,
      {
        name: 'ECDH',
        namedCurve: 'P-256',
      },
      true,
      []
    );
  }

  // Dériver une clé partagée (ECDH)
  async deriveSharedKey(otherPublicKeyBase64: string, userId: string): Promise<void> {
    if (!this.keyPair) {
      throw new Error('Key pair not generated');
    }

    try {
      const otherPublicKey = await this.importPublicKey(otherPublicKeyBase64);

      const sharedSecret = await globalThis.crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: otherPublicKey,
        },
        this.keyPair.privateKey,
        256
      );

      // Créer une clé AES-GCM à partir du secret partagé
      const sharedKey = await globalThis.crypto.subtle.importKey(
        'raw',
        sharedSecret,
        {
          name: 'AES-GCM',
          length: 256,
        },
        false,
        ['encrypt', 'decrypt']
      );

      this.sharedKeys.set(userId, sharedKey);
    } catch (error) {
      console.error('Error deriving shared key:', error);
      throw error;
    }
  }

  // Chiffrer un message
  async encryptMessage(message: string, userId: string): Promise<{ encrypted: string; iv: string }> {
    const sharedKey = this.sharedKeys.get(userId);
    if (!sharedKey) {
      throw new Error('Shared key not found for user');
    }

    try {
      // Générer un IV aléatoire
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

      // Encoder le message
      const encoder = new TextEncoder();
      const data = encoder.encode(message);

      // Chiffrer
      const encryptedBuffer = await globalThis.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        sharedKey,
        data
      );

      return {
        encrypted: this.arrayBufferToBase64(encryptedBuffer),
        iv: this.arrayBufferToBase64(iv.buffer),
      };
    } catch (error) {
      console.error('Error encrypting message:', error);
      throw error;
    }
  }

  // Déchiffrer un message
  async decryptMessage(encryptedBase64: string, ivBase64: string, userId: string): Promise<string> {
    const sharedKey = this.sharedKeys.get(userId);
    if (!sharedKey) {
      throw new Error('Shared key not found for user');
    }

    try {
      const encrypted = this.base64ToArrayBuffer(encryptedBase64);
      const iv = this.base64ToArrayBuffer(ivBase64);

      // Déchiffrer
      const decryptedBuffer = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv,
        },
        sharedKey,
        encrypted
      );

      // Décoder
      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch (error) {
      console.error('Error decrypting message:', error);
      throw error;
    }
  }

  // Générer un code de vérification (Safety Number)
  async generateSafetyNumber(myPublicKey: string, otherPublicKey: string): Promise<string> {
    const combined = myPublicKey + otherPublicKey;
    const encoder = new TextEncoder();
    const data = encoder.encode(combined);

    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // Formater en groupes de 5 chiffres
    const numbers = hashHex.match(/.{1,5}/g) || [];
    return numbers.slice(0, 12).join(' ');
  }

  // Utilitaires de conversion
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCodePoint(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.codePointAt(i) || 0;
    }
    return bytes.buffer;
  }

  /**
   * Check if this manager has been initialized with keys
   * @returns true if key pair exists
   */
  hasKeys(): boolean {
    return this.keyPair !== null;
  }

  /**
   * Get the current public key if available
   * @returns Base64 encoded public key or null
   */
  async getPublicKey(): Promise<string | null> {
    if (!this.keyPair) return null;
    try {
      const publicKeyBuffer = await globalThis.crypto.subtle.exportKey('spki', this.keyPair.publicKey);
      return this.arrayBufferToBase64(publicKeyBuffer);
    } catch {
      return null;
    }
  }

  /**
   * Check if a shared key exists for a user
   * @param userId - User ID to check
   * @returns true if shared key exists
   */
  hasSharedKey(userId: string): boolean {
    return this.sharedKeys.has(userId);
  }

  /**
   * Clear all keys (for logout/migration)
   */
  clearKeys(): void {
    this.keyPair = null;
    this.sharedKeys.clear();
  }
}

/**
 * @deprecated Use getMessagingService() from ./crypto/messagingService instead
 */
export const e2eeManager = new E2EEManager();

// ============================================================================
// Migration Helpers
// ============================================================================

/**
 * Check if a message was encrypted with the legacy system
 * Legacy messages have a specific structure with 'encrypted' and 'iv' fields
 *
 * @param message - Message object to check
 * @returns true if message uses legacy encryption
 */
export function isLegacyEncryptedMessage(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false;
  const msg = message as Record<string, unknown>;
  return (
    typeof msg.encrypted === 'string' &&
    typeof msg.iv === 'string' &&
    !('header' in msg) && // New messages have headers
    !('signature' in msg) // New messages have signatures
  );
}

/**
 * Decrypt a legacy message using the old E2EE system
 *
 * @param encryptedBase64 - Base64 encoded encrypted content
 * @param ivBase64 - Base64 encoded IV
 * @param userId - User ID for the shared key
 * @returns Decrypted message string
 * @throws Error if decryption fails
 */
export async function decryptLegacyMessage(
  encryptedBase64: string,
  ivBase64: string,
  userId: string
): Promise<string> {
  return e2eeManager.decryptMessage(encryptedBase64, ivBase64, userId);
}

/**
 * Re-encrypt a legacy message with the new military-grade E2EE system
 * This is useful for migrating old messages to the new format
 *
 * @param legacyEncrypted - Legacy encrypted message data
 * @param userId - User ID for decryption
 * @param newEncryptFn - Function to encrypt with new system
 * @returns New encrypted message or null if migration fails
 */
export async function migrateLegacyMessage(
  legacyEncrypted: { encrypted: string; iv: string },
  userId: string,
  newEncryptFn: (plaintext: string) => Promise<unknown>
): Promise<unknown> {
  try {
    // Decrypt with legacy system
    const plaintext = await e2eeManager.decryptMessage(
      legacyEncrypted.encrypted,
      legacyEncrypted.iv,
      userId
    );
    
    // Re-encrypt with new system
    return await newEncryptFn(plaintext);
  } catch (error) {
    console.error('Failed to migrate legacy message:', error);
    return null;
  }
}