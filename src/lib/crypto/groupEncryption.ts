// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Group Encryption using Sender Keys Protocol
 * 
 * Each group member has their own sender key that they use to encrypt messages.
 * The sender key is distributed to all group members via pairwise E2EE channels.
 * 
 * This implementation follows the Signal Protocol's Sender Keys approach:
 * - Each member generates a unique sender key for each group
 * - Sender keys are distributed via the existing E2EE messaging channels
 * - Messages are encrypted once and can be decrypted by all group members
 * - Forward secrecy is maintained through chain key ratcheting
 * 
 * Security Properties:
 * - Efficient group messaging (encrypt once, decrypt many)
 * - Forward secrecy within sender key chains
 * - Key rotation on member removal for post-compromise security
 * - Authenticated encryption with sender signatures
 * 
 * @module crypto/groupEncryption
 */

import { randomBytes } from '@noble/hashes/utils';
import { gcm } from '@noble/ciphers/aes';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { sign, verify, generateSigningKeyPair, Ed25519KeyPair } from './signatures';
import { hkdf } from './hkdf';
import { E2EEMessagingService, getMessagingService, EncryptedMessagePayload } from './messagingService';

/**
 * Sender Key for group encryption
 */
export interface SenderKey {
  /** Chain key for deriving message keys (32 bytes) */
  chainKey: Uint8Array;
  /** Public signing key for message authentication (32 bytes) */
  publicSigningKey: Uint8Array;
  /** Private signing key (only for own sender key) (32 bytes) */
  privateSigningKey?: Uint8Array;
  /** Current iteration/message number in the chain */
  iteration: number;
}

/**
 * Group state containing all sender keys
 */
export interface GroupState {
  /** Unique group identifier */
  groupId: string;
  /** Set of member user IDs */
  members: Set<string>;
  /** Our own sender key for this group */
  ownSenderKey: SenderKey;
  /** Sender keys from other members: memberId -> SenderKey */
  memberSenderKeys: Map<string, SenderKey>;
  /** Group creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
}

/**
 * Encrypted group message structure
 */
export interface EncryptedGroupMessage {
  /** Group identifier */
  groupId: string;
  /** Sender's user ID */
  senderId: string;
  /** Chain iteration when message was encrypted */
  iteration: number;
  /** Encrypted message content */
  ciphertext: Uint8Array;
  /** Ed25519 signature of the message */
  signature: Uint8Array;
  /** Nonce used for encryption (12 bytes) */
  nonce: Uint8Array;
}

/**
 * Serialized encrypted group message for transmission
 */
export interface SerializedGroupMessage {
  /** Group identifier */
  groupId: string;
  /** Sender's user ID */
  senderId: string;
  /** Chain iteration */
  iteration: number;
  /** Base64 encoded ciphertext */
  ciphertext: string;
  /** Base64 encoded signature */
  signature: string;
  /** Base64 encoded nonce */
  nonce: string;
}

/**
 * Sender key distribution message
 */
export interface SenderKeyDistribution {
  /** Group identifier */
  groupId: string;
  /** Sender's user ID */
  senderId: string;
  /** Chain key (encrypted via pairwise E2EE) */
  chainKey: Uint8Array;
  /** Public signing key */
  publicSigningKey: Uint8Array;
  /** Current iteration */
  iteration: number;
}

/**
 * Serialized sender key distribution for transmission
 */
export interface SerializedSenderKeyDistribution {
  /** Group identifier */
  groupId: string;
  /** Sender's user ID */
  senderId: string;
  /** Base64 encoded chain key */
  chainKey: string;
  /** Base64 encoded public signing key */
  publicSigningKey: string;
  /** Current iteration */
  iteration: number;
}

/**
 * Ratchet a sender key to derive message key and new chain key
 * 
 * @param senderKey - Current sender key
 * @returns Object containing message key and updated sender key
 */
function ratchetSenderKey(senderKey: SenderKey): { 
  messageKey: Uint8Array; 
  newSenderKey: SenderKey 
} {
  // Derive message key using HMAC
  const messageKeyInput = new Uint8Array([0x01]);
  const messageKey = hmac(sha256, senderKey.chainKey, messageKeyInput);
  
  // Derive new chain key using HMAC
  const chainKeyInput = new Uint8Array([0x02]);
  const newChainKey = hmac(sha256, senderKey.chainKey, chainKeyInput);
  
  return {
    messageKey,
    newSenderKey: {
      chainKey: newChainKey,
      publicSigningKey: senderKey.publicSigningKey,
      privateSigningKey: senderKey.privateSigningKey,
      iteration: senderKey.iteration + 1
    }
  };
}

/**
 * Generate a new sender key for a group
 * 
 * @returns New SenderKey with signing key pair
 */
function generateSenderKey(): SenderKey {
  const chainKey = randomBytes(32);
  const signingKeyPair = generateSigningKeyPair();
  
  return {
    chainKey,
    publicSigningKey: signingKeyPair.publicKey,
    privateSigningKey: signingKeyPair.privateKey,
    iteration: 0
  };
}

/**
 * Group Encryption Manager
 * 
 * Manages group encryption using the Sender Keys protocol.
 * Integrates with the E2EE messaging service for key distribution.
 */
export class GroupEncryptionManager {
  private groups: Map<string, GroupState> = new Map();
  private messagingService: E2EEMessagingService;
  private userId: string | null = null;
  
  /**
   * Create a new GroupEncryptionManager
   * 
   * @param messagingService - E2EE messaging service for key distribution
   */
  constructor(messagingService?: E2EEMessagingService) {
    this.messagingService = messagingService || getMessagingService();
  }
  
  /**
   * Initialize the manager with user ID
   * 
   * @param userId - Current user's ID
   */
  initialize(userId: string): void {
    this.userId = userId;
    console.log('[GroupEncryption] Initialized for user:', userId);
  }
  
  /**
   * Create a new group and generate sender key
   * 
   * @param groupId - Unique group identifier
   * @param memberIds - Array of member user IDs (including self)
   * @throws Error if not initialized
   */
  async createGroup(groupId: string, memberIds: string[]): Promise<void> {
    this.ensureInitialized();
    
    if (this.groups.has(groupId)) {
      throw new Error(`Group ${groupId} already exists`);
    }
    
    // Generate our sender key for this group
    const ownSenderKey = generateSenderKey();
    
    // Create group state
    const groupState: GroupState = {
      groupId,
      members: new Set(memberIds),
      ownSenderKey,
      memberSenderKeys: new Map(),
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    
    this.groups.set(groupId, groupState);
    
    // Distribute our sender key to all other members
    await this.distributeSenderKey(groupId, memberIds.filter(id => id !== this.userId));
    
    console.log(`[GroupEncryption] Created group ${groupId} with ${memberIds.length} members`);
  }
  
  /**
   * Join an existing group
   * Generates own sender key and distributes to members
   * 
   * @param groupId - Group identifier
   * @param memberIds - Array of existing member user IDs
   */
  async joinGroup(groupId: string, memberIds: string[]): Promise<void> {
    this.ensureInitialized();
    
    if (this.groups.has(groupId)) {
      console.log(`[GroupEncryption] Already in group ${groupId}`);
      return;
    }
    
    // Generate our sender key for this group
    const ownSenderKey = generateSenderKey();
    
    // Create group state
    const groupState: GroupState = {
      groupId,
      members: new Set([...memberIds, this.userId!]),
      ownSenderKey,
      memberSenderKeys: new Map(),
      createdAt: Date.now(),
      lastActivityAt: Date.now()
    };
    
    this.groups.set(groupId, groupState);
    
    // Distribute our sender key to all members
    await this.distributeSenderKey(groupId, memberIds);
    
    console.log(`[GroupEncryption] Joined group ${groupId}`);
  }
  
  /**
   * Leave a group
   * Triggers key rotation for remaining members
   * 
   * @param groupId - Group identifier
   */
  async leaveGroup(groupId: string): Promise<void> {
    this.ensureInitialized();
    
    const group = this.groups.get(groupId);
    if (!group) {
      console.log(`[GroupEncryption] Not in group ${groupId}`);
      return;
    }
    
    // Notify other members (they should rotate their keys)
    // In a real implementation, this would send a leave notification
    // that triggers key rotation on the receiving end
    
    // Remove group state
    this.groups.delete(groupId);
    
    console.log(`[GroupEncryption] Left group ${groupId}`);
  }
  
  /**
   * Add a member to the group
   * Distributes existing sender keys to new member
   * 
   * @param groupId - Group identifier
   * @param memberId - New member's user ID
   */
  async addMember(groupId: string, memberId: string): Promise<void> {
    this.ensureInitialized();
    
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }
    
    if (group.members.has(memberId)) {
      console.log(`[GroupEncryption] Member ${memberId} already in group ${groupId}`);
      return;
    }
    
    // Add member to group
    group.members.add(memberId);
    group.lastActivityAt = Date.now();
    
    // Distribute our sender key to the new member
    await this.distributeSenderKey(groupId, [memberId]);
    
    console.log(`[GroupEncryption] Added member ${memberId} to group ${groupId}`);
  }
  
  /**
   * Remove a member from the group
   * Triggers sender key rotation for all remaining members
   * 
   * @param groupId - Group identifier
   * @param memberId - Member's user ID to remove
   */
  async removeMember(groupId: string, memberId: string): Promise<void> {
    this.ensureInitialized();
    
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }
    
    if (!group.members.has(memberId)) {
      console.log(`[GroupEncryption] Member ${memberId} not in group ${groupId}`);
      return;
    }
    
    // Remove member
    group.members.delete(memberId);
    group.memberSenderKeys.delete(memberId);
    group.lastActivityAt = Date.now();
    
    // Rotate our sender key for forward secrecy
    await this.rotateSenderKey(groupId);
    
    console.log(`[GroupEncryption] Removed member ${memberId} from group ${groupId}`);
  }
  
  /**
   * Encrypt a message for the group
   * Uses own sender key
   * 
   * @param groupId - Group identifier
   * @param plaintext - Message to encrypt
   * @returns Encrypted group message
   */
  async encryptGroupMessage(groupId: string, plaintext: string): Promise<EncryptedGroupMessage> {
    this.ensureInitialized();
    
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }
    
    if (!group.ownSenderKey.privateSigningKey) {
      throw new Error('Own sender key missing private signing key');
    }
    
    // Ratchet the sender key to get message key
    const { messageKey, newSenderKey } = ratchetSenderKey(group.ownSenderKey);
    const currentIteration = group.ownSenderKey.iteration;
    
    // Update sender key
    group.ownSenderKey = newSenderKey;
    group.lastActivityAt = Date.now();
    
    // Encrypt the message
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const nonce = randomBytes(12);
    
    // Derive encryption key from message key
    const encryptionKey = hkdf(
      messageKey,
      new Uint8Array(32),
      new TextEncoder().encode('group-message-key'),
      32
    );
    
    const cipher = gcm(encryptionKey, nonce);
    const ciphertext = cipher.encrypt(plaintextBytes);
    
    // Sign the message
    const signatureData = new Uint8Array([
      ...new TextEncoder().encode(groupId),
      ...new TextEncoder().encode(this.userId!),
      ...new Uint8Array(new Uint32Array([currentIteration]).buffer),
      ...ciphertext
    ]);
    
    const signature = sign(signatureData, group.ownSenderKey.privateSigningKey!);
    
    return {
      groupId,
      senderId: this.userId!,
      iteration: currentIteration,
      ciphertext,
      signature,
      nonce
    };
  }
  
  /**
   * Decrypt a group message
   * Uses sender's sender key
   * 
   * @param message - Encrypted group message
   * @returns Decrypted message string
   */
  async decryptGroupMessage(message: EncryptedGroupMessage): Promise<string> {
    this.ensureInitialized();
    
    const group = this.groups.get(message.groupId);
    if (!group) {
      throw new Error(`Group ${message.groupId} not found`);
    }
    
    // Get sender's key
    let senderKey: SenderKey;
    if (message.senderId === this.userId) {
      // Our own message (shouldn't normally happen, but handle it)
      senderKey = group.ownSenderKey;
    } else {
      const memberKey = group.memberSenderKeys.get(message.senderId);
      if (!memberKey) {
        throw new Error(`No sender key for member ${message.senderId}`);
      }
      senderKey = memberKey;
    }
    
    // Ratchet to the correct iteration
    let currentKey = senderKey;
    while (currentKey.iteration < message.iteration) {
      const { newSenderKey } = ratchetSenderKey(currentKey);
      currentKey = newSenderKey;
    }
    
    if (currentKey.iteration !== message.iteration) {
      throw new Error(`Cannot decrypt message: iteration mismatch (have ${currentKey.iteration}, need ${message.iteration})`);
    }
    
    // Get message key
    const { messageKey, newSenderKey } = ratchetSenderKey(currentKey);
    
    // Update stored sender key
    if (message.senderId !== this.userId) {
      group.memberSenderKeys.set(message.senderId, newSenderKey);
    }
    group.lastActivityAt = Date.now();
    
    // Verify signature
    const signatureData = new Uint8Array([
      ...new TextEncoder().encode(message.groupId),
      ...new TextEncoder().encode(message.senderId),
      ...new Uint8Array(new Uint32Array([message.iteration]).buffer),
      ...message.ciphertext
    ]);
    
    const signatureValid = verify(signatureData, message.signature, currentKey.publicSigningKey);
    if (!signatureValid) {
      throw new Error('Message signature verification failed');
    }
    
    // Derive encryption key
    const encryptionKey = hkdf(
      messageKey,
      new Uint8Array(32),
      new TextEncoder().encode('group-message-key'),
      32
    );
    
    // Decrypt
    const cipher = gcm(encryptionKey, message.nonce);
    const plaintextBytes = cipher.decrypt(message.ciphertext);
    
    return new TextDecoder().decode(plaintextBytes);
  }
  
  /**
   * Process a sender key distribution message
   * Called when receiving a sender key from another member
   * 
   * @param groupId - Group identifier
   * @param senderId - Sender's user ID
   * @param distribution - Sender key distribution data
   */
  async processSenderKeyDistribution(
    groupId: string, 
    senderId: string, 
    distribution: SenderKeyDistribution
  ): Promise<void> {
    this.ensureInitialized();
    
    let group = this.groups.get(groupId);
    
    // Create group if it doesn't exist
    if (!group) {
      const ownSenderKey = generateSenderKey();
      group = {
        groupId,
        members: new Set([this.userId!, senderId]),
        ownSenderKey,
        memberSenderKeys: new Map(),
        createdAt: Date.now(),
        lastActivityAt: Date.now()
      };
      this.groups.set(groupId, group);
    }
    
    // Store the sender key
    const senderKey: SenderKey = {
      chainKey: distribution.chainKey,
      publicSigningKey: distribution.publicSigningKey,
      iteration: distribution.iteration
    };
    
    group.memberSenderKeys.set(senderId, senderKey);
    group.members.add(senderId);
    group.lastActivityAt = Date.now();
    
    console.log(`[GroupEncryption] Received sender key from ${senderId} for group ${groupId}`);
  }
  
  /**
   * Rotate own sender key (for forward secrecy)
   * Should be called after member removal
   * 
   * @param groupId - Group identifier
   */
  async rotateSenderKey(groupId: string): Promise<void> {
    this.ensureInitialized();
    
    const group = this.groups.get(groupId);
    if (!group) {
      throw new Error(`Group ${groupId} not found`);
    }
    
    // Generate new sender key
    group.ownSenderKey = generateSenderKey();
    group.lastActivityAt = Date.now();
    
    // Distribute new sender key to all members
    const otherMembers = Array.from(group.members).filter(id => id !== this.userId);
    await this.distributeSenderKey(groupId, otherMembers);
    
    console.log(`[GroupEncryption] Rotated sender key for group ${groupId}`);
  }
  
  /**
   * Distribute sender key to specified members
   * 
   * @param groupId - Group identifier
   * @param memberIds - Members to send key to
   */
  private async distributeSenderKey(groupId: string, memberIds: string[]): Promise<void> {
    const group = this.groups.get(groupId);
    if (!group) return;
    
    const distribution: SenderKeyDistribution = {
      groupId,
      senderId: this.userId!,
      chainKey: group.ownSenderKey.chainKey,
      publicSigningKey: group.ownSenderKey.publicSigningKey,
      iteration: group.ownSenderKey.iteration
    };
    
    // In a real implementation, this would encrypt and send via the messaging service
    // For now, we just log the distribution
    console.log(`[GroupEncryption] Distributing sender key to ${memberIds.length} members`);
    
    // The actual distribution would look like:
    // for (const memberId of memberIds) {
    //   if (this.messagingService.hasSession(memberId)) {
    //     const payload = await this.messagingService.encryptMessage(
    //       memberId,
    //       JSON.stringify(serializeSenderKeyDistribution(distribution))
    //     );
    //     // Send payload via Supabase
    //   }
    // }
  }
  
  /**
   * Get group info
   * 
   * @param groupId - Group identifier
   * @returns Group info or null if not found
   */
  getGroupInfo(groupId: string): { members: string[]; hasAllKeys: boolean } | null {
    const group = this.groups.get(groupId);
    if (!group) return null;
    
    const members = Array.from(group.members);
    const otherMembers = members.filter(id => id !== this.userId);
    const hasAllKeys = otherMembers.every(id => group.memberSenderKeys.has(id));
    
    return {
      members,
      hasAllKeys
    };
  }
  
  /**
   * Check if we're in a group
   * 
   * @param groupId - Group identifier
   * @returns true if in group
   */
  isInGroup(groupId: string): boolean {
    return this.groups.has(groupId);
  }
  
  /**
   * Get all group IDs
   * 
   * @returns Array of group IDs
   */
  getGroupIds(): string[] {
    return Array.from(this.groups.keys());
  }
  
  /**
   * Ensure the manager is initialized
   */
  private ensureInitialized(): void {
    if (!this.userId) {
      throw new Error('GroupEncryptionManager not initialized. Call initialize() first.');
    }
  }
}

/**
 * Serialize an encrypted group message for transmission
 * 
 * @param message - Encrypted group message
 * @returns Serialized message
 */
export function serializeGroupMessage(message: EncryptedGroupMessage): SerializedGroupMessage {
  return {
    groupId: message.groupId,
    senderId: message.senderId,
    iteration: message.iteration,
    ciphertext: bytesToBase64(message.ciphertext),
    signature: bytesToBase64(message.signature),
    nonce: bytesToBase64(message.nonce)
  };
}

/**
 * Deserialize an encrypted group message
 * 
 * @param serialized - Serialized message
 * @returns Encrypted group message
 */
export function deserializeGroupMessage(serialized: SerializedGroupMessage): EncryptedGroupMessage {
  return {
    groupId: serialized.groupId,
    senderId: serialized.senderId,
    iteration: serialized.iteration,
    ciphertext: base64ToBytes(serialized.ciphertext),
    signature: base64ToBytes(serialized.signature),
    nonce: base64ToBytes(serialized.nonce)
  };
}

/**
 * Serialize a sender key distribution for transmission
 * 
 * @param distribution - Sender key distribution
 * @returns Serialized distribution
 */
export function serializeSenderKeyDistribution(
  distribution: SenderKeyDistribution
): SerializedSenderKeyDistribution {
  return {
    groupId: distribution.groupId,
    senderId: distribution.senderId,
    chainKey: bytesToBase64(distribution.chainKey),
    publicSigningKey: bytesToBase64(distribution.publicSigningKey),
    iteration: distribution.iteration
  };
}

/**
 * Deserialize a sender key distribution
 * 
 * @param serialized - Serialized distribution
 * @returns Sender key distribution
 */
export function deserializeSenderKeyDistribution(
  serialized: SerializedSenderKeyDistribution
): SenderKeyDistribution {
  return {
    groupId: serialized.groupId,
    senderId: serialized.senderId,
    chainKey: base64ToBytes(serialized.chainKey),
    publicSigningKey: base64ToBytes(serialized.publicSigningKey),
    iteration: serialized.iteration
  };
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

// Singleton instance
let groupEncryptionInstance: GroupEncryptionManager | null = null;

/**
 * Get the group encryption manager singleton instance
 * 
 * @returns GroupEncryptionManager instance
 */
export function getGroupEncryptionManager(): GroupEncryptionManager {
  if (!groupEncryptionInstance) {
    groupEncryptionInstance = new GroupEncryptionManager();
  }
  return groupEncryptionInstance;
}

/**
 * Reset the group encryption manager (for testing)
 */
export function resetGroupEncryptionManager(): void {
  groupEncryptionInstance = null;
}