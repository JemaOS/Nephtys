# ANU Crypto API Reference

## Military-Grade End-to-End Encryption API Documentation

This document provides comprehensive API documentation for the ANU messaging application's cryptographic module.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [E2EE Messaging Service](#e2ee-messaging-service)
3. [Key Management](#key-management)
4. [Session Management](#session-management)
5. [Message Encryption](#message-encryption)
6. [Group Encryption](#group-encryption)
7. [WebRTC E2EE](#webrtc-e2ee)
8. [Utility Functions](#utility-functions)
9. [Type Definitions](#type-definitions)
10. [Error Handling](#error-handling)

---

## Quick Start

### Installation

The crypto module is built into the ANU application. Import from the crypto module:

```typescript
import { 
  getMessagingService,
  getSecureKeyStorage,
  getGroupEncryptionManager,
  createE2EEManager
} from '@/lib/crypto';
```

### Basic Usage

#### Initializing the E2EE Service

```typescript
import { getMessagingService } from '@/lib/crypto';

// Get the singleton messaging service
const service = getMessagingService();

// Initialize with user credentials
await service.initialize(userId, userPassword);

// Check if ready
if (service.isReady()) {
  console.log('E2EE service initialized');
}
```

#### Sending an Encrypted Message

```typescript
// First, establish a session with the recipient
const recipientBundle = await fetchPublicKeyBundleFromServer(recipientId);
await service.establishSession(recipientId, recipientBundle);

// Encrypt and send a message
const encrypted = await service.encryptMessage(recipientId, "Hello, World!");

// Send the encrypted payload to your server
await sendToServer(encrypted);
```

#### Receiving an Encrypted Message

```typescript
// Receive encrypted payload from server
const encryptedPayload = await receiveFromServer();

// For initial messages, accept the session first
if (encryptedPayload.type === 'initial') {
  await service.acceptSession(
    encryptedPayload.senderId,
    senderIdentityKey,
    base64ToBytes(encryptedPayload.ephemeralPublicKey),
    encryptedPayload.usedOneTimePreKeyId
  );
}

// Decrypt the message
const plaintext = await service.decryptMessage(encryptedPayload);
console.log('Received:', plaintext);
```

---

## E2EE Messaging Service

### `E2EEMessagingService`

The main service class for end-to-end encrypted messaging.

#### Constructor

```typescript
const service = new E2EEMessagingService();
// Or use the singleton:
const service = getMessagingService();
```

#### Methods

##### `initialize(userId: string, password: string): Promise<void>`

Initialize the service with user credentials.

```typescript
await service.initialize('user-123', 'secure-password');
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | `string` | User's unique identifier |
| `password` | `string` | User's password for key encryption |

**Throws:** `Error` if initialization fails

---

##### `getPublicKeyBundle(): Promise<PublicKeyBundle>`

Get the public key bundle for sharing with other users.

```typescript
const bundle = await service.getPublicKeyBundle();
// Upload bundle to server for other users to fetch
await uploadToServer(bundle);
```

**Returns:** `PublicKeyBundle` containing identity key, signed pre-key, and optionally a one-time pre-key.

---

##### `establishSession(recipientId: string, recipientKeyBundle: PublicKeyBundle): Promise<void>`

Establish a new E2EE session with a recipient using X3DH.

```typescript
const recipientBundle = await fetchFromServer(recipientId);
await service.establishSession(recipientId, recipientBundle);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `recipientId` | `string` | Recipient's user ID |
| `recipientKeyBundle` | `PublicKeyBundle` | Recipient's public key bundle |

**Throws:** `Error` if key bundle signature is invalid

---

##### `acceptSession(senderId: string, senderIdentityKey: Uint8Array, ephemeralPublicKey: Uint8Array, usedOneTimePreKeyId?: number): Promise<void>`

Accept an incoming session from a sender (called when receiving first message).

```typescript
await service.acceptSession(
  senderId,
  senderIdentityKey,
  ephemeralPublicKey,
  usedOneTimePreKeyId
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `senderId` | `string` | Sender's user ID |
| `senderIdentityKey` | `Uint8Array` | Sender's identity public key |
| `ephemeralPublicKey` | `Uint8Array` | Sender's ephemeral public key |
| `usedOneTimePreKeyId` | `number?` | ID of the one-time pre-key used |

---

##### `encryptMessage(recipientId: string, plaintext: string): Promise<EncryptedMessagePayload>`

Encrypt a message for a recipient.

```typescript
const encrypted = await service.encryptMessage(recipientId, "Secret message");
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `recipientId` | `string` | Recipient's user ID |
| `plaintext` | `string` | Message to encrypt |

**Returns:** `EncryptedMessagePayload` ready for transmission

**Throws:** `Error` if no session exists for recipient

---

##### `decryptMessage(payload: EncryptedMessagePayload): Promise<string>`

Decrypt a received message.

```typescript
const plaintext = await service.decryptMessage(encryptedPayload);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `payload` | `EncryptedMessagePayload` | Encrypted message payload |

**Returns:** Decrypted message string

**Throws:** `Error` if decryption fails or no session exists

---

##### `generateSafetyNumber(recipientId: string, recipientIdentityKey: Uint8Array): Promise<string>`

Generate a safety number for out-of-band verification.

```typescript
const safetyNumber = await service.generateSafetyNumber(
  recipientId,
  recipientIdentityKey
);
// Display: "12345 67890 12345 67890 12345 67890"
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `recipientId` | `string` | Recipient's user ID |
| `recipientIdentityKey` | `Uint8Array` | Recipient's identity public key |

**Returns:** Formatted safety number string

---

##### `hasSession(peerId: string): boolean`

Check if a session exists for a peer.

```typescript
if (service.hasSession(recipientId)) {
  // Can send encrypted messages
}
```

---

##### `deleteSession(peerId: string): Promise<void>`

Delete a session with a peer.

```typescript
await service.deleteSession(peerId);
```

---

##### `lock(): void`

Lock the service and clear keys from memory.

```typescript
service.lock();
// Must call initialize() again to use
```

---

##### `isReady(): boolean`

Check if the service is initialized and ready.

```typescript
if (service.isReady()) {
  // Service is ready for use
}
```

---

##### `replenishOneTimeKeys(count?: number): Promise<Array<{ keyId: number; publicKey: Uint8Array }>>`

Generate new one-time pre-keys.

```typescript
const newKeys = await service.replenishOneTimeKeys(50);
// Upload new keys to server
await uploadOneTimeKeys(newKeys);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `count` | `number` | `50` | Number of keys to generate |

**Returns:** Array of new public one-time keys

---

##### `getOneTimeKeyCount(): number`

Get the number of remaining one-time pre-keys.

```typescript
const count = service.getOneTimeKeyCount();
if (count < 20) {
  await service.replenishOneTimeKeys(50);
}
```

---

## Key Management

### `SecureKeyStorage`

Manages encrypted storage of cryptographic keys.

#### Getting the Instance

```typescript
import { getSecureKeyStorage } from '@/lib/crypto';

const storage = getSecureKeyStorage();
```

#### Methods

##### `initialize(password: string): Promise<void>`

Initialize storage with user's password.

```typescript
await storage.initialize('user-password');
```

---

##### `storeKeyBundle(bundle: KeyBundle): Promise<void>`

Store a key bundle (encrypts private keys).

```typescript
await storage.storeKeyBundle(keyBundle);
```

---

##### `getKeyBundle(): Promise<KeyBundle | null>`

Retrieve the key bundle (decrypts private keys).

```typescript
const bundle = await storage.getKeyBundle();
```

---

##### `storeSession(peerId: string, state: RatchetState): Promise<void>`

Store a Double Ratchet session state.

```typescript
await storage.storeSession(peerId, ratchetState);
```

---

##### `getSession(peerId: string): Promise<RatchetState | null>`

Retrieve a session state.

```typescript
const state = await storage.getSession(peerId);
```

---

##### `deleteSession(peerId: string): Promise<void>`

Delete a session.

```typescript
await storage.deleteSession(peerId);
```

---

##### `changePassword(currentPassword: string, newPassword: string): Promise<void>`

Change the storage password (re-encrypts all keys).

```typescript
await storage.changePassword('old-password', 'new-password');
```

---

##### `exportBackup(): Promise<string>`

Export an encrypted backup of all keys.

```typescript
const backup = await storage.exportBackup();
// Store backup securely
```

---

##### `importBackup(backupData: string): Promise<void>`

Import keys from an encrypted backup.

```typescript
await storage.importBackup(backupData);
```

---

##### `clearAll(): Promise<void>`

Securely delete all stored keys.

```typescript
await storage.clearAll();
```

---

##### `lock(): void`

Lock storage and clear keys from memory.

```typescript
storage.lock();
```

---

##### `isUnlocked(): boolean`

Check if storage is unlocked.

```typescript
if (storage.isUnlocked()) {
  // Storage is ready
}
```

---

## Session Management

### High-Level Session Functions

#### `generateIdentity(numOneTimeKeys?: number): CryptoIdentity`

Generate a new cryptographic identity.

```typescript
import { generateIdentity } from '@/lib/crypto';

const identity = generateIdentity(100);
console.log('Fingerprint:', identity.fingerprint);
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `numOneTimeKeys` | `number` | `100` | Number of one-time pre-keys |

**Returns:** `CryptoIdentity` with key bundle and fingerprint

---

#### `establishSession(ourIdentity: CryptoIdentity, theirPublicBundle: PublicKeyBundle, sessionId: string): E2EESession`

Establish a session as the initiator.

```typescript
import { establishSession } from '@/lib/crypto';

const session = establishSession(myIdentity, theirBundle, 'session-123');
```

---

#### `acceptSession(ourIdentity: CryptoIdentity, theirIdentityKey: Uint8Array, theirEphemeralKey: Uint8Array, usedOneTimeKeyId: number | undefined, sessionId: string): E2EESession`

Accept a session as the responder.

```typescript
import { acceptSession } from '@/lib/crypto';

const session = acceptSession(
  myIdentity,
  theirIdentityKey,
  theirEphemeralKey,
  usedOneTimeKeyId,
  'session-123'
);
```

---

#### `sessionEncrypt(session: E2EESession, message: string): { session: E2EESession; encrypted: EncryptedMessage }`

Encrypt a message in a session.

```typescript
import { sessionEncrypt } from '@/lib/crypto';

const { session: newSession, encrypted } = sessionEncrypt(session, "Hello!");
session = newSession; // Update session state
```

---

#### `sessionDecrypt(session: E2EESession, encrypted: EncryptedMessage): { session: E2EESession; message: string }`

Decrypt a message in a session.

```typescript
import { sessionDecrypt } from '@/lib/crypto';

const { session: newSession, message } = sessionDecrypt(session, encrypted);
session = newSession; // Update session state
```

---

#### `getSecurityFingerprint(session: E2EESession, ourIdentityKey: Uint8Array): string`

Get the security fingerprint for verification.

```typescript
import { getSecurityFingerprint } from '@/lib/crypto';

const fingerprint = getSecurityFingerprint(session, myIdentityKey);
```

---

## Message Encryption

### Double Ratchet Functions

#### `ratchetInitAlice(SK: Uint8Array, bobPublicKey: Uint8Array): RatchetState`

Initialize Double Ratchet as Alice (initiator).

```typescript
import { ratchetInitAlice } from '@/lib/crypto';

const state = ratchetInitAlice(sharedSecret, bobSignedPreKey);
```

---

#### `ratchetInitBob(SK: Uint8Array, bobKeyPair: KeyPair): RatchetState`

Initialize Double Ratchet as Bob (responder).

```typescript
import { ratchetInitBob } from '@/lib/crypto';

const state = ratchetInitBob(sharedSecret, mySignedPreKeyPair);
```

---

#### `ratchetEncrypt(state: RatchetState, plaintext: Uint8Array): [RatchetState, EncryptedMessage]`

Encrypt a message using Double Ratchet.

```typescript
import { ratchetEncrypt } from '@/lib/crypto';

const plaintext = new TextEncoder().encode("Hello!");
const [newState, encrypted] = ratchetEncrypt(state, plaintext);
state = newState;
```

---

#### `ratchetDecrypt(state: RatchetState, message: EncryptedMessage): [RatchetState, Uint8Array]`

Decrypt a message using Double Ratchet.

```typescript
import { ratchetDecrypt } from '@/lib/crypto';

const [newState, plaintext] = ratchetDecrypt(state, encrypted);
state = newState;
const message = new TextDecoder().decode(plaintext);
```

---

#### `encryptMessage(state: RatchetState, message: string): [RatchetState, EncryptedMessage]`

High-level message encryption (string input).

```typescript
import { encryptMessage } from '@/lib/crypto';

const [newState, encrypted] = encryptMessage(state, "Hello!");
```

---

#### `decryptMessage(state: RatchetState, encrypted: EncryptedMessage): [RatchetState, string]`

High-level message decryption (string output).

```typescript
import { decryptMessage } from '@/lib/crypto';

const [newState, message] = decryptMessage(state, encrypted);
```

---

#### `serializeEncryptedMessage(message: EncryptedMessage): string`

Serialize encrypted message for transmission.

```typescript
import { serializeEncryptedMessage } from '@/lib/crypto';

const serialized = serializeEncryptedMessage(encrypted);
// Send serialized string
```

---

#### `deserializeEncryptedMessage(encoded: string): EncryptedMessage`

Deserialize encrypted message from transmission.

```typescript
import { deserializeEncryptedMessage } from '@/lib/crypto';

const encrypted = deserializeEncryptedMessage(serialized);
```

---

### AEAD Encryption

#### `encryptAEAD(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, associatedData?: Uint8Array): Uint8Array`

Encrypt with associated data.

```typescript
import { encryptAEAD, generateNonce } from '@/lib/crypto';

const nonce = generateNonce();
const ciphertext = encryptAEAD(key, nonce, plaintext, associatedData);
```

---

#### `decryptAEAD(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array, associatedData?: Uint8Array): Uint8Array`

Decrypt with associated data.

```typescript
import { decryptAEAD } from '@/lib/crypto';

const plaintext = decryptAEAD(key, nonce, ciphertext, associatedData);
```

---

## Group Encryption

### `GroupEncryptionManager`

Manages group encryption using Sender Keys protocol.

#### Getting the Instance

```typescript
import { getGroupEncryptionManager } from '@/lib/crypto';

const groupManager = getGroupEncryptionManager();
groupManager.initialize(userId);
```

#### Methods

##### `initialize(userId: string): void`

Initialize the manager with user ID.

```typescript
groupManager.initialize('user-123');
```

---

##### `createGroup(groupId: string, memberIds: string[]): Promise<void>`

Create a new group.

```typescript
await groupManager.createGroup('group-123', ['user-1', 'user-2', 'user-3']);
```

---

##### `joinGroup(groupId: string, memberIds: string[]): Promise<void>`

Join an existing group.

```typescript
await groupManager.joinGroup('group-123', ['user-1', 'user-2']);
```

---

##### `leaveGroup(groupId: string): Promise<void>`

Leave a group.

```typescript
await groupManager.leaveGroup('group-123');
```

---

##### `addMember(groupId: string, memberId: string): Promise<void>`

Add a member to a group.

```typescript
await groupManager.addMember('group-123', 'new-user');
```

---

##### `removeMember(groupId: string, memberId: string): Promise<void>`

Remove a member from a group (triggers key rotation).

```typescript
await groupManager.removeMember('group-123', 'removed-user');
```

---

##### `encryptGroupMessage(groupId: string, plaintext: string): Promise<EncryptedGroupMessage>`

Encrypt a message for the group.

```typescript
const encrypted = await groupManager.encryptGroupMessage('group-123', "Hello group!");
```

---

##### `decryptGroupMessage(message: EncryptedGroupMessage): Promise<string>`

Decrypt a group message.

```typescript
const plaintext = await groupManager.decryptGroupMessage(encrypted);
```

---

##### `processSenderKeyDistribution(groupId: string, senderId: string, distribution: SenderKeyDistribution): Promise<void>`

Process a received sender key distribution.

```typescript
await groupManager.processSenderKeyDistribution(groupId, senderId, distribution);
```

---

##### `rotateSenderKey(groupId: string): Promise<void>`

Rotate own sender key (for forward secrecy).

```typescript
await groupManager.rotateSenderKey('group-123');
```

---

##### `getGroupInfo(groupId: string): { members: string[]; hasAllKeys: boolean } | null`

Get group information.

```typescript
const info = groupManager.getGroupInfo('group-123');
if (info && info.hasAllKeys) {
  // Ready to send messages
}
```

---

### Serialization Functions

#### `serializeGroupMessage(message: EncryptedGroupMessage): SerializedGroupMessage`

Serialize group message for transmission.

```typescript
import { serializeGroupMessage } from '@/lib/crypto';

const serialized = serializeGroupMessage(encrypted);
```

---

#### `deserializeGroupMessage(serialized: SerializedGroupMessage): EncryptedGroupMessage`

Deserialize group message.

```typescript
import { deserializeGroupMessage } from '@/lib/crypto';

const encrypted = deserializeGroupMessage(serialized);
```

---

## WebRTC E2EE

### `WebRTCE2EEManager`

Manages end-to-end encryption for WebRTC media streams.

#### Creating an Instance

```typescript
import { createE2EEManager, supportsInsertableStreams } from '@/lib/crypto';

// Check browser support
if (!supportsInsertableStreams()) {
  console.warn('WebRTC E2EE not supported');
  return;
}

// Create manager
const e2ee = await createE2EEManager(peerConnection, sharedSecret);
```

#### Methods

##### `initialize(sharedSecret: Uint8Array): Promise<void>`

Initialize with shared secret.

```typescript
await e2ee.initialize(sharedSecret);
```

---

##### `enableE2EE(): Promise<void>`

Enable E2EE for all tracks.

```typescript
// Add tracks first
peerConnection.addTrack(videoTrack, stream);
peerConnection.addTrack(audioTrack, stream);

// Then enable E2EE
await e2ee.enableE2EE();
```

---

##### `rotateKey(newSharedSecret: Uint8Array): Promise<void>`

Rotate the encryption key.

```typescript
await e2ee.rotateKey(newSharedSecret);
```

---

##### `disable(): void`

Disable E2EE and cleanup.

```typescript
e2ee.disable();
```

---

##### `enabled: boolean` (getter)

Check if E2EE is enabled.

```typescript
if (e2ee.enabled) {
  console.log('E2EE is active');
}
```

---

##### `keyId: number` (getter)

Get current key ID.

```typescript
console.log('Current key ID:', e2ee.keyId);
```

---

### Helper Functions

#### `supportsInsertableStreams(): boolean`

Check browser support for Insertable Streams.

```typescript
import { supportsInsertableStreams } from '@/lib/crypto';

if (supportsInsertableStreams()) {
  // WebRTC E2EE is supported
}
```

---

#### `deriveFrameKey(sharedSecret: Uint8Array, keyId: number): Promise<CryptoKey>`

Derive a frame encryption key.

```typescript
import { deriveFrameKey } from '@/lib/crypto';

const frameKey = await deriveFrameKey(sharedSecret, 0);
```

---

## Utility Functions

### Encoding/Decoding

#### `bytesToHex(bytes: Uint8Array): string`

Convert bytes to hexadecimal string.

```typescript
import { bytesToHex } from '@/lib/crypto';

const hex = bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
// "deadbeef"
```

---

#### `hexToBytes(hex: string): Uint8Array`

Convert hexadecimal string to bytes.

```typescript
import { hexToBytes } from '@/lib/crypto';

const bytes = hexToBytes("deadbeef");
```

---

#### `bytesToBase64(bytes: Uint8Array): string`

Convert bytes to Base64 string.

```typescript
import { bytesToBase64 } from '@/lib/crypto';

const base64 = bytesToBase64(bytes);
```

---

#### `base64ToBytes(base64: string): Uint8Array`

Convert Base64 string to bytes.

```typescript
import { base64ToBytes } from '@/lib/crypto';

const bytes = base64ToBytes(base64);
```

---

### Security Functions

#### `secureRandomBytes(length: number): Uint8Array`

Generate cryptographically secure random bytes.

```typescript
import { secureRandomBytes } from '@/lib/crypto';

const random = secureRandomBytes(32);
```

---

#### `secureCompare(a: Uint8Array, b: Uint8Array): boolean`

Constant-time comparison of byte arrays.

```typescript
import { secureCompare } from '@/lib/crypto';

if (secureCompare(hash1, hash2)) {
  // Hashes match
}
```

---

#### `secureClear(data: Uint8Array): void`

Clear sensitive data from memory (best effort).

```typescript
import { secureClear } from '@/lib/crypto';

secureClear(privateKey);
```

---

### Key Derivation

#### `hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array`

HKDF key derivation.

```typescript
import { hkdf } from '@/lib/crypto';

const derivedKey = hkdf(inputKey, salt, info, 32);
```

---

#### `deriveKeys(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengths: number[]): Uint8Array[]`

Derive multiple keys at once.

```typescript
import { deriveKeys } from '@/lib/crypto';

const [key1, key2] = deriveKeys(inputKey, salt, info, [32, 32]);
```

---

### Digital Signatures

#### `generateSigningKeyPair(): Ed25519KeyPair`

Generate Ed25519 signing key pair.

```typescript
import { generateSigningKeyPair } from '@/lib/crypto';

const keyPair = generateSigningKeyPair();
```

---

#### `sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array`

Sign a message.

```typescript
import { sign } from '@/lib/crypto';

const signature = sign(message, privateKey);
```

---

#### `verify(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean`

Verify a signature.

```typescript
import { verify } from '@/lib/crypto';

if (verify(message, signature, publicKey)) {
  // Signature is valid
}
```

---

### X25519 Key Exchange

#### `generateX25519KeyPair(): X25519KeyPair`

Generate X25519 key pair.

```typescript
import { generateX25519KeyPair } from '@/lib/crypto';

const keyPair = generateX25519KeyPair();
```

---

#### `x25519DH(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array`

Perform X25519 Diffie-Hellman.

```typescript
import { x25519DH } from '@/lib/crypto';

const sharedSecret = x25519DH(myPrivateKey, theirPublicKey);
```

---

## Type Definitions

### Core Types

```typescript
// Key pair types
interface X25519KeyPair {
  publicKey: Uint8Array;  // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

interface Ed25519KeyPair {
  publicKey: Uint8Array;  // 32 bytes
  privateKey: Uint8Array; // 32 bytes
}

interface KeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}
```

### Key Bundle Types

```typescript
interface SignedPreKey {
  keyPair: X25519KeyPair;
  signature: Uint8Array;  // 64 bytes
  keyId: number;
  timestamp: number;
}

interface OneTimePreKey {
  keyPair: X25519KeyPair;
  keyId: number;
}

interface KeyBundle {
  identityKey: Ed25519KeyPair;
  signedPreKey: SignedPreKey;
  oneTimePreKeys: OneTimePreKey[];
}

interface PublicKeyBundle {
  identityKey: Uint8Array;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  signedPreKeyId: number;
  oneTimePreKey?: Uint8Array;
  oneTimePreKeyId?: number;
}
```

### Session Types

```typescript
interface RatchetState {
  DHs: KeyPair;
  DHr: Uint8Array | null;
  RK: Uint8Array;
  CKs: Uint8Array | null;
  CKr: Uint8Array | null;
  Ns: number;
  Nr: number;
  PN: number;
  MKSKIPPED: Map<string, Uint8Array>;
}

interface E2EESession {
  sessionId: string;
  remoteIdentityKey: Uint8Array;
  ratchetState: RatchetState;
  isInitiator: boolean;
  createdAt: number;
  lastActivityAt: number;
}

interface CryptoIdentity {
  keyBundle: KeyBundle;
  fingerprint: string;
}
```

### Message Types

```typescript
interface MessageHeader {
  dh: Uint8Array;  // 32 bytes
  pn: number;
  n: number;
}

interface EncryptedMessage {
  header: Uint8Array;
  ciphertext: Uint8Array;
  nonce: Uint8Array;       // 12 bytes
  headerNonce: Uint8Array; // 12 bytes
}

interface EncryptedMessagePayload {
  type: 'initial' | 'message';
  senderId: string;
  recipientId: string;
  timestamp: number;
  ephemeralPublicKey?: string;
  usedOneTimePreKeyId?: number;
  encryptedContent: string;
  header: string;
  headerNonce: string;
  nonce: string;
  signature: string;
}
```

### Group Encryption Types

```typescript
interface SenderKey {
  chainKey: Uint8Array;
  publicSigningKey: Uint8Array;
  privateSigningKey?: Uint8Array;
  iteration: number;
}

interface GroupState {
  groupId: string;
  members: Set<string>;
  ownSenderKey: SenderKey;
  memberSenderKeys: Map<string, SenderKey>;
  createdAt: number;
  lastActivityAt: number;
}

interface EncryptedGroupMessage {
  groupId: string;
  senderId: string;
  iteration: number;
  ciphertext: Uint8Array;
  signature: Uint8Array;
  nonce: Uint8Array;
}

interface SenderKeyDistribution {
  groupId: string;
  senderId: string;
  chainKey: Uint8Array;
  publicSigningKey: Uint8Array;
  iteration: number;
}
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `MessagingService not initialized` | Service not initialized | Call `initialize()` first |
| `No session exists for recipient` | No established session | Call `establishSession()` first |
| `Invalid key bundle signature` | Tampered or invalid bundle | Verify bundle source |
| `Message decryption failed` | Wrong key or tampered message | Check session state |
| `Too many skipped messages` | More than 1000 skipped | Re-establish session |
| `Storage not initialized` | Key storage not unlocked | Call `storage.initialize()` |
| `Invalid password` | Wrong password for storage | Verify password |

### Error Handling Example

```typescript
try {
  const plaintext = await service.decryptMessage(encrypted);
} catch (error) {
  if (error.message.includes('No session exists')) {
    // Need to establish session first
    await service.acceptSession(senderId, ...);
    const plaintext = await service.decryptMessage(encrypted);
  } else if (error.message.includes('decryption failed')) {
    // Message may be corrupted or session out of sync
    console.error('Failed to decrypt message');
  } else {
    throw error;
  }
}
```

---

## Best Practices

### 1. Session Management

```typescript
// Always check for existing session before establishing
if (!service.hasSession(recipientId)) {
  const bundle = await fetchPublicKeyBundle(recipientId);
  await service.establishSession(recipientId, bundle);
}
```

### 2. Key Rotation

```typescript
// Check and replenish one-time keys periodically
const count = service.getOneTimeKeyCount();
if (count < 20) {
  const newKeys = await service.replenishOneTimeKeys(50);
  await uploadOneTimeKeys(newKeys);
}
```

### 3. Safety Number Verification

```typescript
// Display safety number for user verification
const safetyNumber = await service.generateSafetyNumber(
  recipientId,
  recipientIdentityKey
);
displaySafetyNumber(safetyNumber);
```

### 4. Secure Cleanup

```typescript
// Lock service when user logs out
window.addEventListener('beforeunload', () => {
  service.lock();
});
```

### 5. Error Recovery

```typescript
// Handle session corruption
async function sendMessage(recipientId: string, message: string) {
  try {
    return await service.encryptMessage(recipientId, message);
  } catch (error) {
    // Re-establish session on failure
    await service.deleteSession(recipientId);
    const bundle = await fetchPublicKeyBundle(recipientId);
    await service.establishSession(recipientId, bundle);
    return await service.encryptMessage(recipientId, message);
  }
}
```

---

*© 2025 ANU/Nephtys. All rights reserved.*