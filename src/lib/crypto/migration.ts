/**
 * Migration Utility for Transitioning to Military-Grade E2EE
 * 
 * This module provides utilities for migrating from the legacy P-256 ECDH
 * encryption system to the new military-grade E2EE system based on the
 * Signal Protocol.
 * 
 * Migration Process:
 * 1. Generate new key bundle (X25519/Ed25519)
 * 2. Store keys securely with password protection
 * 3. Create migration token for notifying contacts
 * 4. Upload new public key bundle to server
 * 5. Notify contacts of key change
 * 
 * @module crypto/migration
 */

import { 
  generateKeyBundle, 
  getPublicKeyBundle, 
  PublicKeyBundle,
  KeyBundle 
} from './x3dh';
import { 
  SecureKeyStorage, 
  getSecureKeyStorage 
} from './keyStorage';
import { 
  E2EEMessagingService, 
  getMessagingService 
} from './messagingService';
import { sign } from './signatures';
import { hkdf } from './hkdf';

/**
 * Migration result containing new keys and migration token
 */
export interface MigrationResult {
  /** Whether migration was successful */
  success: boolean;
  /** New public key bundle for upload to server */
  newPublicKeyBundle: PublicKeyBundle;
  /** Migration token for notifying contacts of key change */
  migrationToken: string;
  /** Error message if migration failed */
  error?: string;
}

/**
 * Migration status for tracking progress
 */
export interface MigrationStatus {
  /** Whether migration has been started */
  started: boolean;
  /** Whether new keys have been generated */
  keysGenerated: boolean;
  /** Whether keys have been stored */
  keysStored: boolean;
  /** Whether contacts have been notified */
  contactsNotified: boolean;
  /** Timestamp of migration */
  timestamp: number;
}

/**
 * Contact notification result
 */
export interface NotificationResult {
  /** Contact ID */
  contactId: string;
  /** Whether notification was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Migrate to military-grade E2EE
 * 
 * Generates new key bundle using X25519/Ed25519 and stores it securely.
 * Creates a migration token that can be used to notify contacts of the key change.
 * 
 * @param userId - User's unique identifier
 * @param password - Password for encrypting the new keys
 * @param oldPublicKey - Optional old P-256 public key (for verification)
 * @param oldPrivateKey - Optional old P-256 private key (for signing migration)
 * @returns MigrationResult with new keys and migration token
 * 
 * @example
 * ```typescript
 * const result = await migrateToMilitaryGradeE2EE(
 *   'user123',
 *   'secure-password',
 *   oldPublicKey,
 *   oldPrivateKey
 * );
 * 
 * if (result.success) {
 *   // Upload result.newPublicKeyBundle to server
 *   // Notify contacts with result.migrationToken
 * }
 * ```
 */
export async function migrateToMilitaryGradeE2EE(
  userId: string,
  password: string,
  oldPublicKey?: CryptoKey,
  oldPrivateKey?: CryptoKey
): Promise<MigrationResult> {
  try {
    // Initialize the messaging service (this will generate or load keys)
    const messagingService = getMessagingService();
    await messagingService.initialize(userId, password);
    
    // Get the public key bundle
    const newPublicKeyBundle = await messagingService.getPublicKeyBundle();
    
    // Generate migration token
    const migrationToken = await generateMigrationToken(
      userId,
      newPublicKeyBundle,
      oldPublicKey,
      oldPrivateKey
    );
    
    console.log('[Migration] Successfully migrated to military-grade E2EE');
    
    return {
      success: true,
      newPublicKeyBundle,
      migrationToken
    };
  } catch (error) {
    console.error('[Migration] Failed to migrate:', error);
    return {
      success: false,
      newPublicKeyBundle: {} as PublicKeyBundle,
      migrationToken: '',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Generate a migration token
 * 
 * The migration token contains:
 * - User ID
 * - New identity public key fingerprint
 * - Timestamp
 * - Optional signature from old key (for verification)
 * 
 * @param userId - User's ID
 * @param newBundle - New public key bundle
 * @param oldPublicKey - Optional old public key
 * @param oldPrivateKey - Optional old private key for signing
 * @returns Base64 encoded migration token
 */
async function generateMigrationToken(
  userId: string,
  newBundle: PublicKeyBundle,
  oldPublicKey?: CryptoKey,
  oldPrivateKey?: CryptoKey
): Promise<string> {
  const timestamp = Date.now();
  
  // Create token data
  const tokenData = {
    userId,
    newIdentityKeyFingerprint: bytesToHex(newBundle.identityKey).substring(0, 40),
    timestamp,
    version: 1
  };
  
  const tokenJson = JSON.stringify(tokenData);
  const tokenBytes = new TextEncoder().encode(tokenJson);
  
  // If we have old keys, sign the token with them for verification
  let signature: ArrayBuffer | null = null;
  if (oldPrivateKey) {
    try {
      signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        oldPrivateKey,
        tokenBytes
      );
    } catch (error) {
      console.warn('[Migration] Could not sign with old key:', error);
    }
  }
  
  // Combine token and signature
  const result = {
    token: tokenJson,
    signature: signature ? arrayBufferToBase64(signature) : null
  };
  
  return btoa(JSON.stringify(result));
}

/**
 * Verify a migration token
 * 
 * @param migrationToken - Base64 encoded migration token
 * @param expectedUserId - Expected user ID
 * @param oldPublicKey - Old public key for signature verification
 * @returns Verification result
 */
export async function verifyMigrationToken(
  migrationToken: string,
  expectedUserId: string,
  oldPublicKey?: CryptoKey
): Promise<{
  valid: boolean;
  userId?: string;
  newIdentityKeyFingerprint?: string;
  timestamp?: number;
  signatureValid?: boolean;
}> {
  try {
    const decoded = JSON.parse(atob(migrationToken));
    const tokenData = JSON.parse(decoded.token);
    
    // Verify user ID
    if (tokenData.userId !== expectedUserId) {
      return { valid: false };
    }
    
    // Verify timestamp (not too old - within 7 days)
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    if (Date.now() - tokenData.timestamp > maxAge) {
      return { valid: false };
    }
    
    // Verify signature if old public key provided
    let signatureValid = false;
    if (oldPublicKey && decoded.signature) {
      try {
        const tokenBytes = new TextEncoder().encode(decoded.token);
        const signatureBytes = base64ToArrayBuffer(decoded.signature);
        
        signatureValid = await crypto.subtle.verify(
          { name: 'ECDSA', hash: 'SHA-256' },
          oldPublicKey,
          signatureBytes,
          tokenBytes
        );
      } catch {
        signatureValid = false;
      }
    }
    
    return {
      valid: true,
      userId: tokenData.userId,
      newIdentityKeyFingerprint: tokenData.newIdentityKeyFingerprint,
      timestamp: tokenData.timestamp,
      signatureValid
    };
  } catch {
    return { valid: false };
  }
}

/**
 * Notify contacts of key change
 * 
 * Sends migration notifications to specified contacts via the messaging system.
 * Contacts should verify the migration token and update their stored keys.
 * 
 * @param contacts - Array of contact user IDs
 * @param migrationToken - Migration token to send
 * @param sendNotification - Function to send notification to a contact
 * @returns Array of notification results
 * 
 * @example
 * ```typescript
 * const results = await notifyContactsOfKeyChange(
 *   ['contact1', 'contact2'],
 *   migrationToken,
 *   async (contactId, message) => {
 *     // Send via your messaging system
 *     await supabase.from('messages').insert({
 *       recipient_id: contactId,
 *       type: 'key_change',
 *       content: message
 *     });
 *   }
 * );
 * ```
 */
export async function notifyContactsOfKeyChange(
  contacts: string[],
  migrationToken: string,
  sendNotification?: (contactId: string, message: string) => Promise<void>
): Promise<NotificationResult[]> {
  const results: NotificationResult[] = [];
  
  for (const contactId of contacts) {
    try {
      if (sendNotification) {
        const message = JSON.stringify({
          type: 'key_change_notification',
          migrationToken,
          timestamp: Date.now()
        });
        
        await sendNotification(contactId, message);
      }
      
      results.push({
        contactId,
        success: true
      });
      
      console.log(`[Migration] Notified contact: ${contactId}`);
    } catch (error) {
      results.push({
        contactId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      console.error(`[Migration] Failed to notify contact ${contactId}:`, error);
    }
  }
  
  return results;
}

/**
 * Process a key change notification from a contact
 * 
 * @param notification - Key change notification message
 * @param senderOldPublicKey - Sender's old public key for verification
 * @returns Processing result
 */
export async function processKeyChangeNotification(
  notification: string,
  senderOldPublicKey?: CryptoKey
): Promise<{
  valid: boolean;
  senderId?: string;
  newFingerprint?: string;
  shouldUpdateKey: boolean;
}> {
  try {
    const data = JSON.parse(notification);
    
    if (data.type !== 'key_change_notification') {
      return { valid: false, shouldUpdateKey: false };
    }
    
    const verification = await verifyMigrationToken(
      data.migrationToken,
      '', // We don't know the expected user ID yet
      senderOldPublicKey
    );
    
    if (!verification.valid) {
      return { valid: false, shouldUpdateKey: false };
    }
    
    return {
      valid: true,
      senderId: verification.userId,
      newFingerprint: verification.newIdentityKeyFingerprint,
      shouldUpdateKey: verification.signatureValid !== false
    };
  } catch {
    return { valid: false, shouldUpdateKey: false };
  }
}

/**
 * Get migration status for a user
 * 
 * @param userId - User ID to check
 * @returns Migration status
 */
export async function getMigrationStatus(userId: string): Promise<MigrationStatus> {
  const keyStorage = getSecureKeyStorage();
  
  try {
    // Check if we can access the key storage (indicates keys exist)
    const hasKeys = keyStorage.isUnlocked();
    
    return {
      started: hasKeys,
      keysGenerated: hasKeys,
      keysStored: hasKeys,
      contactsNotified: false, // Would need to track this separately
      timestamp: Date.now()
    };
  } catch {
    return {
      started: false,
      keysGenerated: false,
      keysStored: false,
      contactsNotified: false,
      timestamp: 0
    };
  }
}

/**
 * Export keys for backup before migration
 * 
 * @param password - Password to encrypt the backup
 * @returns Encrypted backup string
 */
export async function exportKeysForBackup(password: string): Promise<string | null> {
  try {
    const keyStorage = getSecureKeyStorage();
    
    if (!keyStorage.isUnlocked()) {
      await keyStorage.initialize(password);
    }
    
    return await keyStorage.exportBackup();
  } catch (error) {
    console.error('[Migration] Failed to export keys:', error);
    return null;
  }
}

/**
 * Import keys from backup
 * 
 * @param backupData - Encrypted backup string
 * @param password - Password to decrypt the backup
 * @returns Success status
 */
export async function importKeysFromBackup(
  backupData: string,
  password: string
): Promise<boolean> {
  try {
    const keyStorage = getSecureKeyStorage();
    
    if (!keyStorage.isUnlocked()) {
      await keyStorage.initialize(password);
    }
    
    await keyStorage.importBackup(backupData);
    return true;
  } catch (error) {
    console.error('[Migration] Failed to import keys:', error);
    return false;
  }
}

/**
 * Clean up old encryption data after successful migration
 * 
 * @param clearLocalStorage - Whether to clear localStorage entries
 * @param clearIndexedDB - Whether to clear old IndexedDB data
 */
export async function cleanupOldEncryptionData(
  clearLocalStorage: boolean = false,
  clearIndexedDB: boolean = false
): Promise<void> {
  if (clearLocalStorage) {
    // Remove old encryption keys from localStorage
    const keysToRemove = [
      'e2ee_public_key',
      'e2ee_private_key',
      'e2ee_shared_keys'
    ];
    
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    
    console.log('[Migration] Cleared old localStorage entries');
  }
  
  if (clearIndexedDB) {
    // Remove old IndexedDB databases
    const dbsToRemove = [
      'old-encryption-db',
      'legacy-keys-db'
    ];
    
    for (const dbName of dbsToRemove) {
      try {
        indexedDB.deleteDatabase(dbName);
      } catch {
        // Ignore errors
      }
    }
    
    console.log('[Migration] Cleared old IndexedDB databases');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert ArrayBuffer to Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert Base64 to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}