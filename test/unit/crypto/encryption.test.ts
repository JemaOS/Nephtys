import { E2EEManager } from '../../../src/lib/encryption';

describe('E2EEManager', () => {
  let alice: E2EEManager;
  let bob: E2EEManager;

  beforeEach(() => {
    alice = new E2EEManager();
    bob = new E2EEManager();
  });

  it('should generate key pair', async () => {
    const keys = await alice.generateKeyPair();
    expect(keys.publicKey).toBeDefined();
    expect(keys.privateKey).toBeDefined();
    expect(typeof keys.publicKey).toBe('string');
    expect(typeof keys.privateKey).toBe('string');
    expect(alice.hasKeys()).toBe(true);
  });

  it('should derive shared key and encrypt/decrypt messages', async () => {
    // 1. Generate keys for both users
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();

    // 2. Exchange public keys and derive shared keys
    await alice.deriveSharedKey(bobKeys.publicKey, 'bob-id');
    await bob.deriveSharedKey(aliceKeys.publicKey, 'alice-id');

    expect(alice.hasSharedKey('bob-id')).toBe(true);
    expect(bob.hasSharedKey('alice-id')).toBe(true);

    // 3. Alice encrypts a message for Bob
    const message = 'Hello Bob, this is a secret message!';
    const encryptedData = await alice.encryptMessage(message, 'bob-id');

    expect(encryptedData.encrypted).toBeDefined();
    expect(encryptedData.iv).toBeDefined();

    // 4. Bob decrypts the message
    const decryptedMessage = await bob.decryptMessage(
      encryptedData.encrypted,
      encryptedData.iv,
      'alice-id'
    );

    expect(decryptedMessage).toBe(message);
  });

  it('should fail to decrypt with wrong key', async () => {
    const aliceKeys = await alice.generateKeyPair();
    const bobKeys = await bob.generateKeyPair();
    const eve = new E2EEManager();
    await eve.generateKeyPair();

    await alice.deriveSharedKey(bobKeys.publicKey, 'bob-id');
    // Eve tries to derive key with Alice's public key but her own private key
    // This will result in a different shared secret than what Alice and Bob have
    await eve.deriveSharedKey(aliceKeys.publicKey, 'alice-id');

    const message = 'Secret';
    const encryptedData = await alice.encryptMessage(message, 'bob-id');

    // Eve tries to decrypt
    await expect(eve.decryptMessage(
      encryptedData.encrypted,
      encryptedData.iv,
      'alice-id'
    )).rejects.toThrow();
  });
});
