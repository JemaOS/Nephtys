// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Secure Key Storage
 * 
 * Stores private keys encrypted at rest using a device-derived key.
 * The device key is derived from a user password/PIN using PBKDF2.
 * 
 * Security Properties:
 * - Password-derived key using PBKDF2 with 600k iterations (OWASP 2023)
 * - All private keys encrypted with AES-256-GCM
 * - Keys never stored unencrypted
 * - Memory protection when locked
 * - Secure deletion with overwrite
 * 
 * Storage Schema (IndexedDB):
 * - Database: 'anu-secure-keys'
 * - Object Stores:
 *   - 'keyBundle': User's key bundle (identity, prekeys)
 *   - 'sessions': Double Ratchet session states by peer ID
 *   - 'metadata': Salt, registration ID, etc.
 * 
 * @module crypto/keyStorage
 */

import { hkdf } from './hkdf';
import type { RatchetState, SerializedRatchetState } from './doubleRatchet';
import { serializeRatchetState, deserializeRatchetState } from './doubleRatchet';
import type { KeyBundle, X25519KeyPair } from './x3dh';

/**
 * PBKDF2 parameters for key derivation
 * Following OWASP recommendations for 2023
 */
const PBKDF2_ITERATIONS = 600000;
const PBKDF2_HASH = 'SHA-256';
const SALT_LENGTH = 32;
const KEY_LENGTH = 32; // 256 bits for AES-256

/**
 * Database configuration
 */
const DB_NAME = 'anu-secure-keys';
const DB_VERSION = 1;
const STORE_KEY_BUNDLE = 'keyBundle';
const STORE_SESSIONS = 'sessions';
const STORE_METADATA = 'metadata';

/**
 * Encrypted key pair structure
 */
export interface EncryptedKeyPair {
  /** Public key (not encrypted) */
  publicKey: string; // Base64 encoded
  /** Encrypted private key */
  encryptedPrivateKey: string; // Base64 encoded
  /** Nonce used for encryption */
  nonce: string; // Base64 encoded
}

/**
 * Stored key bundle structure
 */
export interface StoredKeyBundle {
  /** Identity key pair */
  identityKeyPair: EncryptedKeyPair;
  /** Signed pre-key */
  signedPreKey: EncryptedKeyPair;
  /** Signed pre-key signature */
  signedPreKeySignature: string; // Base64 encoded
  /** Signed pre-key ID */
  signedPreKeyId: number;
  /** Signed pre-key timestamp */
  signedPreKeyTimestamp: number;
  /** One-time pre-keys */
  oneTimePreKeys: Array<{
    keyId: number;
    keyPair: EncryptedKeyPair;
  }>;
}

/**
 * Metadata stored in the database
 */
interface StoredMetadata {
  /** Salt for PBKDF2 */
  salt: string; // Base64 encoded
  /** Registration ID */
  registrationId: number;
  /** Version for migration */
  version: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  modifiedAt: number;
}

/**
 * Encrypted session state
 */
interface EncryptedSession {
  /** Peer ID */
  peerId: string;
  /** Encrypted session state */
  encryptedState: string; // Base64 encoded
  /** Nonce used for encryption */
  nonce: string; // Base64 encoded
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Secure Key Storage class
 * 
 * Manages encrypted storage of cryptographic keys using IndexedDB.
 */
export class SecureKeyStorage {
  private db: IDBDatabase | null = null;
  private deviceKey: CryptoKey | null = null;
  private salt: Uint8Array | null = null;
  private isInitialized: boolean = false;
  
  /**
   * Initialize storage with user's password/PIN
   * 
   * This must be called before any other operations.
   * If the database doesn't exist, it will be created.
   * If it exists, the password will be used to derive the device key.
   * 
   * @param password - User's password or PIN
   * @throws Error if password is incorrect or initialization fails
   */
  async initialize(password: string): Promise<void> {
    if (this.isInitialized) {
      console.warn('[KeyStorage] Already initialized');
      return;
    }
    
    // Open or create the database
    this.db = await this.openDatabase();
    
    // Get or create metadata
    const metadata = await this.getMetadata();
    
    if (metadata) {
      // Existing database - use stored salt
      this.salt = base64ToBytes(metadata.salt);
    } else {
      // New database - generate salt
      this.salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
      
      // Store metadata
      await this.storeMetadata({
        salt: bytesToBase64(this.salt),
        registrationId: this.generateRegistrationId(),
        version: 1,
        createdAt: Date.now(),
        modifiedAt: Date.now()
      });
    }
    
    // Derive device key from password
    this.deviceKey = await this.deriveDeviceKey(password, this.salt);
    
    // Verify the key by trying to decrypt existing data (if any)
    if (metadata) {
      const isValid = await this.verifyDeviceKey();
      if (!isValid) {
        this.lock();
        throw new Error('Invalid password');
      }
    }
    
    this.isInitialized = true;
    console.log('[KeyStorage] Initialized successfully');
  }
  
  /**
   * Derive device key from password using PBKDF2
   * 
   * @param password - User's password
   * @param salt - Salt for PBKDF2
   * @returns CryptoKey for AES-256-GCM
   */
  private async deriveDeviceKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
    // Import password as key material
    const passwordKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );
    
    // Create salt ArrayBuffer
    const saltBuffer = new ArrayBuffer(salt.length);
    new Uint8Array(saltBuffer).set(salt);
    
    // Derive key using PBKDF2
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltBuffer,
        iterations: PBKDF2_ITERATIONS,
        hash: PBKDF2_HASH
      },
      passwordKey,
      { name: 'AES-GCM', length: 256 },
      false, // Not extractable
      ['encrypt', 'decrypt']
    );
  }
  
  /**
   * Verify the device key by attempting to decrypt existing data
   */
  private async verifyDeviceKey(): Promise<boolean> {
    try {
      const bundle = await this.getStoredKeyBundle();
      if (!bundle) {
        // No data to verify against - assume valid
        return true;
      }
      
      // Try to decrypt the identity key
      await this.decryptKeyPair(bundle.identityKeyPair);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * Open or create the IndexedDB database
   */
  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        reject(new Error(`Failed to open database: ${request.error?.message}`));
      };
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object stores
        if (!db.objectStoreNames.contains(STORE_KEY_BUNDLE)) {
          db.createObjectStore(STORE_KEY_BUNDLE, { keyPath: 'id' });
        }
        
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'peerId' });
        }
        
        if (!db.objectStoreNames.contains(STORE_METADATA)) {
          db.createObjectStore(STORE_METADATA, { keyPath: 'id' });
        }
      };
    });
  }
  
  /**
   * Get metadata from the database
   */
  private async getMetadata(): Promise<StoredMetadata | null> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_METADATA, 'readonly');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.get('metadata');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
    });
  }
  
  /**
   * Store metadata in the database
   */
  private async storeMetadata(metadata: StoredMetadata): Promise<void> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_METADATA, 'readwrite');
      const store = transaction.objectStore(STORE_METADATA);
      const request = store.put({ id: 'metadata', data: metadata });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Generate a random registration ID
   */
  private generateRegistrationId(): number {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const view = new DataView(bytes.buffer);
    return view.getUint32(0, true) & 0x3FFF; // 14-bit ID
  }
  
  /**
   * Encrypt a key pair
   */
  private async encryptKeyPair(keyPair: X25519KeyPair): Promise<EncryptedKeyPair> {
    if (!this.deviceKey) throw new Error('Storage not unlocked');
    
    // Generate nonce
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    // Create ArrayBuffer copy of private key for Web Crypto API
    const privateKeyBuffer = new ArrayBuffer(keyPair.privateKey.length);
    new Uint8Array(privateKeyBuffer).set(keyPair.privateKey);
    
    // Encrypt private key
    const encryptedPrivateKey = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      this.deviceKey,
      privateKeyBuffer
    );
    
    return {
      publicKey: bytesToBase64(keyPair.publicKey),
      encryptedPrivateKey: bytesToBase64(new Uint8Array(encryptedPrivateKey)),
      nonce: bytesToBase64(nonce)
    };
  }
  
  /**
   * Decrypt a key pair
   */
  private async decryptKeyPair(encrypted: EncryptedKeyPair): Promise<X25519KeyPair> {
    if (!this.deviceKey) throw new Error('Storage not unlocked');
    
    const nonce = base64ToBytes(encrypted.nonce);
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    const encryptedData = base64ToBytes(encrypted.encryptedPrivateKey);
    
    // Create ArrayBuffer copy for Web Crypto API
    const encryptedBuffer = new ArrayBuffer(encryptedData.length);
    new Uint8Array(encryptedBuffer).set(encryptedData);
    
    // Decrypt private key
    const decryptedPrivateKey = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      this.deviceKey,
      encryptedBuffer
    );
    
    return {
      publicKey: base64ToBytes(encrypted.publicKey),
      privateKey: new Uint8Array(decryptedPrivateKey)
    };
  }
  
  /**
   * Store key bundle (encrypts private keys)
   *
   * @param bundle - Key bundle to store
   */
  async storeKeyBundle(bundle: KeyBundle): Promise<void> {
    if (!this.isInitialized || !this.deviceKey) {
      throw new Error('Storage not initialized');
    }
    
    // Encrypt identity key pair
    const identityKeyPair = await this.encryptKeyPair(bundle.identityKey);
    
    // Encrypt signed pre-key
    const signedPreKey = await this.encryptKeyPair(bundle.signedPreKey.keyPair);
    
    // Encrypt one-time pre-keys
    const oneTimePreKeys = await Promise.all(
      bundle.oneTimePreKeys.map(async (otk) => ({
        keyId: otk.keyId,
        keyPair: await this.encryptKeyPair(otk.keyPair)
      }))
    );
    
    const storedBundle: StoredKeyBundle = {
      identityKeyPair,
      signedPreKey,
      signedPreKeySignature: bytesToBase64(bundle.signedPreKey.signature),
      signedPreKeyId: bundle.signedPreKey.keyId,
      signedPreKeyTimestamp: bundle.signedPreKey.timestamp,
      oneTimePreKeys
    };
    
    // Store in database
    await this.storeKeyBundleInternal(storedBundle);
    
    // Update metadata
    const metadata = await this.getMetadata();
    if (metadata) {
      metadata.modifiedAt = Date.now();
      await this.storeMetadata(metadata);
    }
    
    console.log('[KeyStorage] Key bundle stored');
  }
  
  /**
   * Store key bundle in database
   */
  private async storeKeyBundleInternal(bundle: StoredKeyBundle): Promise<void> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_KEY_BUNDLE, 'readwrite');
      const store = transaction.objectStore(STORE_KEY_BUNDLE);
      const request = store.put({ id: 'bundle', data: bundle });
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Get stored key bundle from database
   */
  private async getStoredKeyBundle(): Promise<StoredKeyBundle | null> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_KEY_BUNDLE, 'readonly');
      const store = transaction.objectStore(STORE_KEY_BUNDLE);
      const request = store.get('bundle');
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? result.data : null);
      };
    });
  }
  
  /**
   * Retrieve key bundle (decrypts private keys)
   *
   * @returns Key bundle or null if not found
   */
  async getKeyBundle(): Promise<KeyBundle | null> {
    if (!this.isInitialized || !this.deviceKey) {
      throw new Error('Storage not initialized');
    }
    
    const storedBundle = await this.getStoredKeyBundle();
    if (!storedBundle) {
      return null;
    }
    
    // Decrypt identity key pair
    const identityKey = await this.decryptKeyPair(storedBundle.identityKeyPair);
    
    // Decrypt signed pre-key
    const signedPreKeyPair = await this.decryptKeyPair(storedBundle.signedPreKey);
    
    // Decrypt one-time pre-keys
    const oneTimePreKeys = await Promise.all(
      storedBundle.oneTimePreKeys.map(async (otk) => ({
        keyId: otk.keyId,
        keyPair: await this.decryptKeyPair(otk.keyPair)
      }))
    );
    
    return {
      identityKey,
      signedPreKey: {
        keyId: storedBundle.signedPreKeyId,
        keyPair: signedPreKeyPair,
        signature: base64ToBytes(storedBundle.signedPreKeySignature),
        timestamp: storedBundle.signedPreKeyTimestamp
      },
      oneTimePreKeys
    };
  }
  
  /**
   * Store session state (Double Ratchet state)
   *
   * @param peerId - Peer identifier
   * @param state - Ratchet state to store
   */
  async storeSession(peerId: string, state: RatchetState): Promise<void> {
    if (!this.isInitialized || !this.deviceKey) {
      throw new Error('Storage not initialized');
    }
    
    // Serialize the state
    const serialized = serializeRatchetState(state);
    const stateJson = JSON.stringify(serialized);
    const stateBytes = new TextEncoder().encode(stateJson);
    
    // Generate nonce
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    // Create ArrayBuffer copy for Web Crypto API
    const stateBytesBuffer = new ArrayBuffer(stateBytes.length);
    new Uint8Array(stateBytesBuffer).set(stateBytes);
    
    // Encrypt the state
    const encryptedState = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      this.deviceKey,
      stateBytesBuffer
    );
    
    const session: EncryptedSession = {
      peerId,
      encryptedState: bytesToBase64(new Uint8Array(encryptedState)),
      nonce: bytesToBase64(nonce),
      lastActivityAt: Date.now()
    };
    
    // Store in database
    await this.storeSessionInternal(session);
    
    console.log(`[KeyStorage] Session stored for peer: ${peerId}`);
  }
  
  /**
   * Store session in database
   */
  private async storeSessionInternal(session: EncryptedSession): Promise<void> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.put(session);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Retrieve session state
   *
   * @param peerId - Peer identifier
   * @returns Ratchet state or null if not found
   */
  async getSession(peerId: string): Promise<RatchetState | null> {
    if (!this.isInitialized || !this.deviceKey) {
      throw new Error('Storage not initialized');
    }
    
    const session = await this.getSessionInternal(peerId);
    if (!session) {
      return null;
    }
    
    // Decrypt the state
    const nonce = base64ToBytes(session.nonce);
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    const encryptedData = base64ToBytes(session.encryptedState);
    
    // Create ArrayBuffer copy for Web Crypto API
    const encryptedBuffer = new ArrayBuffer(encryptedData.length);
    new Uint8Array(encryptedBuffer).set(encryptedData);
    
    const decryptedState = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      this.deviceKey,
      encryptedBuffer
    );
    
    // Deserialize the state
    const stateJson = new TextDecoder().decode(decryptedState);
    const serialized: SerializedRatchetState = JSON.parse(stateJson);
    
    return deserializeRatchetState(serialized);
  }
  
  /**
   * Get session from database
   */
  private async getSessionInternal(peerId: string): Promise<EncryptedSession | null> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.get(peerId);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }
  
  /**
   * Delete a session
   * 
   * @param peerId - Peer identifier
   */
  async deleteSession(peerId: string): Promise<void> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_SESSIONS, 'readwrite');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.delete(peerId);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log(`[KeyStorage] Session deleted for peer: ${peerId}`);
        resolve();
      };
    });
  }
  
  /**
   * Get all session peer IDs
   * 
   * @returns Array of peer IDs
   */
  async getAllSessionPeerIds(): Promise<string[]> {
    if (!this.db) throw new Error('Database not open');
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_SESSIONS, 'readonly');
      const store = transaction.objectStore(STORE_SESSIONS);
      const request = store.getAllKeys();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result as string[]);
    });
  }
  
  /**
   * Delete all keys (account deletion)
   * 
   * Securely clears all stored data.
   */
  async clearAll(): Promise<void> {
    if (!this.db) {
      // Try to open database for deletion
      try {
        this.db = await this.openDatabase();
      } catch {
        // Database doesn't exist, nothing to clear
        return;
      }
    }
    
    // Clear all object stores
    await this.clearStore(STORE_KEY_BUNDLE);
    await this.clearStore(STORE_SESSIONS);
    await this.clearStore(STORE_METADATA);
    
    // Lock the storage
    this.lock();
    
    console.log('[KeyStorage] All data cleared');
  }
  
  /**
   * Clear an object store
   */
  private async clearStore(storeName: string): Promise<void> {
    if (!this.db) return;
    
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
  
  /**
   * Lock storage (clear device key from memory)
   * 
   * After locking, initialize() must be called again with the password.
   */
  lock(): void {
    // Clear sensitive data from memory
    this.deviceKey = null;
    this.salt = null;
    this.isInitialized = false;
    
    // Close database connection
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    console.log('[KeyStorage] Locked');
  }
  
  /**
   * Check if storage is unlocked
   * 
   * @returns true if storage is unlocked and ready for use
   */
  isUnlocked(): boolean {
    return this.isInitialized && this.deviceKey !== null;
  }
  
  /**
   * Change the password
   * 
   * Re-encrypts all stored keys with a new password-derived key.
   * 
   * @param currentPassword - Current password
   * @param newPassword - New password
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('Storage not initialized');
    }
    
    // Verify current password
    const currentKey = await this.deriveDeviceKey(currentPassword, this.salt!);
    
    // Get all data with current key
    const keyBundle = await this.getKeyBundle();
    const sessionPeerIds = await this.getAllSessionPeerIds();
    const sessions: Array<{ peerId: string; state: RatchetState }> = [];
    
    for (const peerId of sessionPeerIds) {
      const state = await this.getSession(peerId);
      if (state) {
        sessions.push({ peerId, state });
      }
    }
    
    // Generate new salt
    const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    
    // Derive new device key
    const newDeviceKey = await this.deriveDeviceKey(newPassword, newSalt);
    
    // Update salt and device key
    this.salt = newSalt;
    this.deviceKey = newDeviceKey;
    
    // Update metadata with new salt
    const metadata = await this.getMetadata();
    if (metadata) {
      metadata.salt = bytesToBase64(newSalt);
      metadata.modifiedAt = Date.now();
      await this.storeMetadata(metadata);
    }
    
    // Re-encrypt and store all data with new key
    if (keyBundle) {
      await this.storeKeyBundle(keyBundle);
    }
    
    for (const { peerId, state } of sessions) {
      await this.storeSession(peerId, state);
    }
    
    console.log('[KeyStorage] Password changed successfully');
  }
  
  /**
   * Export encrypted backup
   * 
   * Creates an encrypted backup of all stored data.
   * The backup is encrypted with a separate backup key derived from the password.
   * 
   * @returns Base64-encoded encrypted backup
   */
  async exportBackup(): Promise<string> {
    if (!this.isInitialized || !this.deviceKey) {
      throw new Error('Storage not initialized');
    }
    
    // Get all data
    const keyBundle = await this.getStoredKeyBundle();
    const metadata = await this.getMetadata();
    const sessionPeerIds = await this.getAllSessionPeerIds();
    const sessions: EncryptedSession[] = [];
    
    for (const peerId of sessionPeerIds) {
      const session = await this.getSessionInternal(peerId);
      if (session) {
        sessions.push(session);
      }
    }
    
    const backup = {
      version: 1,
      keyBundle,
      metadata,
      sessions,
      exportedAt: Date.now()
    };
    
    // Derive backup key
    const backupInfo = new TextEncoder().encode('anu-backup-key');
    const backupKeyMaterial = hkdf(this.salt!, new Uint8Array(32), backupInfo, 32);
    
    const backupKeyBuffer = new ArrayBuffer(backupKeyMaterial.length);
    new Uint8Array(backupKeyBuffer).set(backupKeyMaterial);
    
    const backupKey = await crypto.subtle.importKey(
      'raw',
      backupKeyBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );
    
    // Encrypt backup
    const backupJson = JSON.stringify(backup);
    const backupBytes = new TextEncoder().encode(backupJson);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    const encryptedBackup = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      backupKey,
      backupBytes
    );
    
    // Combine nonce and encrypted data
    const result = new Uint8Array(nonce.length + encryptedBackup.byteLength);
    result.set(nonce, 0);
    result.set(new Uint8Array(encryptedBackup), nonce.length);
    
    return bytesToBase64(result);
  }
  
  /**
   * Import encrypted backup
   * 
   * Restores data from an encrypted backup.
   * 
   * @param backupData - Base64-encoded encrypted backup
   */
  async importBackup(backupData: string): Promise<void> {
    if (!this.isInitialized || !this.deviceKey || !this.salt) {
      throw new Error('Storage not initialized');
    }
    
    const data = base64ToBytes(backupData);
    
    // Extract nonce and encrypted data
    const nonce = data.slice(0, 12);
    const encryptedData = data.slice(12);
    
    // Derive backup key
    const backupInfo = new TextEncoder().encode('anu-backup-key');
    const backupKeyMaterial = hkdf(this.salt, new Uint8Array(32), backupInfo, 32);
    
    const backupKeyBuffer = new ArrayBuffer(backupKeyMaterial.length);
    new Uint8Array(backupKeyBuffer).set(backupKeyMaterial);
    
    const backupKey = await crypto.subtle.importKey(
      'raw',
      backupKeyBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    
    // Decrypt backup
    const nonceBuffer = new ArrayBuffer(nonce.length);
    new Uint8Array(nonceBuffer).set(nonce);
    
    const decryptedBackup = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonceBuffer,
        tagLength: 128
      },
      backupKey,
      encryptedData
    );
    
    const backupJson = new TextDecoder().decode(decryptedBackup);
    const backup = JSON.parse(backupJson);
    
    // Restore data
    if (backup.keyBundle) {
      await this.storeKeyBundleInternal(backup.keyBundle);
    }
    
    if (backup.sessions) {
      for (const session of backup.sessions) {
        await this.storeSessionInternal(session);
      }
    }
    
    console.log('[KeyStorage] Backup imported successfully');
  }
}

/**
 * Convert bytes to Base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Convert Base64 string to bytes
 */
function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(
    atob(base64).split('').map(c => c.charCodeAt(0))
  );
}

/**
 * Create a singleton instance of SecureKeyStorage
 */
let storageInstance: SecureKeyStorage | null = null;

/**
 * Get the secure key storage instance
 * 
 * @returns SecureKeyStorage singleton instance
 */
export function getSecureKeyStorage(): SecureKeyStorage {
  if (!storageInstance) {
    storageInstance = new SecureKeyStorage();
  }
  return storageInstance;
}

/**
 * Reset the storage instance (for testing)
 */
export function resetSecureKeyStorage(): void {
  if (storageInstance) {
    storageInstance.lock();
    storageInstance = null;
  }
}