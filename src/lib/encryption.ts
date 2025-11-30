// End-to-End Encryption (E2EE) - Version simplifiée
// Utilise Web Crypto API pour le chiffrement AES-GCM

export class E2EEManager {
  private keyPair: CryptoKeyPair | null = null;
  private sharedKeys: Map<string, CryptoKey> = new Map();

  // Générer une paire de clés (publique/privée)
  async generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
    try {
      this.keyPair = await window.crypto.subtle.generateKey(
        {
          name: 'ECDH',
          namedCurve: 'P-256',
        },
        true,
        ['deriveKey', 'deriveBits']
      );

      // Exporter les clés
      const publicKeyBuffer = await window.crypto.subtle.exportKey('spki', this.keyPair.publicKey);
      const privateKeyBuffer = await window.crypto.subtle.exportKey('pkcs8', this.keyPair.privateKey);

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
    return await window.crypto.subtle.importKey(
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

      const sharedSecret = await window.crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: otherPublicKey,
        },
        this.keyPair.privateKey,
        256
      );

      // Créer une clé AES-GCM à partir du secret partagé
      const sharedKey = await window.crypto.subtle.importKey(
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
      const iv = window.crypto.getRandomValues(new Uint8Array(12));

      // Encoder le message
      const encoder = new TextEncoder();
      const data = encoder.encode(message);

      // Chiffrer
      const encryptedBuffer = await window.crypto.subtle.encrypt(
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
      const decryptedBuffer = await window.crypto.subtle.decrypt(
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

    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
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
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export const e2eeManager = new E2EEManager();