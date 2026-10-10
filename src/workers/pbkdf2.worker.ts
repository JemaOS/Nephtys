// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Web Worker : dérivation PBKDF2 (310k itérations) + chiffrement/déchiffrement
 * AES-GCM hors du thread principal, pour ne pas figer l'UI au déverrouillage.
 *
 * Un CryptoKey n'étant pas transférable, le worker réalise l'opération
 * complète et ne renvoie que du base64.
 */

import {
  encryptPrivateKeyRaw,
  decryptPrivateKeyRaw,
  type EncryptedPrivateKey,
} from '../lib/passphraseCrypto';

interface ReqEncrypt { id: number; op: 'encrypt'; privateKeyPkcs8Base64: string; passphrase: string }
interface ReqDecrypt { id: number; op: 'decrypt'; encrypted: EncryptedPrivateKey; passphrase: string }
type Req = ReqEncrypt | ReqDecrypt;

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
};

ctx.onmessage = async (e: MessageEvent) => {
  const req = e.data as Req;
  try {
    if (req.op === 'encrypt') {
      const result = await encryptPrivateKeyRaw(req.privateKeyPkcs8Base64, req.passphrase);
      ctx.postMessage({ id: req.id, result });
    } else if (req.op === 'decrypt') {
      const result = await decryptPrivateKeyRaw(req.encrypted, req.passphrase);
      ctx.postMessage({ id: req.id, result });
    } else {
      ctx.postMessage({ id: (req as { id: number }).id, error: 'unknown op' });
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, error: (err as Error)?.message || 'worker error' });
  }
};
