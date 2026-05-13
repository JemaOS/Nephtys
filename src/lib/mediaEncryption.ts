// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Chiffrement E2EE des médias (images, vidéos, audios, fichiers).
 *
 * Architecture :
 *   1. Chaque user a une paire ECDH (P-256). Clé privée en IndexedDB local,
 *      clé publique publiée dans profiles.public_key.
 *   2. Pour chaque fichier uploadé :
 *      a. génère une clé AES-256 aléatoire (UNIQUE par fichier)
 *      b. chiffre le binaire avec AES-GCM
 *      c. pour chaque destinataire, chiffre la clé AES avec la clé partagée
 *         sender↔recipient (dérivée par ECDH)
 *      d. stocke les clés enveloppées dans la table message_media_keys
 *   3. Pour lire :
 *      a. récupère la clé enveloppée destinée à soi
 *      b. dérive la clé partagée sender↔soi
 *      c. déchiffre la clé AES
 *      d. télécharge le binaire chiffré et le déchiffre
 *
 * L'admin de la DB ne peut PAS déchiffrer les médias car il n'a pas la clé
 * privée des destinataires (stockée uniquement en local sur leurs appareils).
 */

import { supabase } from './supabase';

const ECDH_PARAMS: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };
const AES_PARAMS: AesKeyAlgorithm = { name: 'AES-GCM', length: 256 };

const IDB_NAME = 'nephtys-e2ee';
const IDB_STORE = 'private-keys';
const IDB_KEY_PREFIX = 'media-private-key-v1';

// ─── Helpers ──────────────────────────────────────────────────────────

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// ─── IndexedDB ────────────────────────────────────────────────────────

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<unknown> {
  const db = await openIdb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Gestion clés ECDH ────────────────────────────────────────────────

interface KeyPairExport {
  publicKey: string;  // base64 SPKI
  privateKey: string; // base64 PKCS8
}

/**
 * Récupère ou génère la paire de clés ECDH du user courant.
 * - Stocke la clé privée en IndexedDB (jamais envoyée au serveur)
 * - Publie la clé publique dans profiles.public_key
 */
export async function ensureUserKeyPair(userId: string): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}> {
  const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
  const cached = (await idbGet(idbKey)) as KeyPairExport | undefined;

  if (cached) {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBuf(cached.publicKey),
      ECDH_PARAMS,
      true,
      []
    );
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      base64ToBuf(cached.privateKey),
      ECDH_PARAMS,
      false,
      ['deriveKey', 'deriveBits']
    );
    return { publicKey, privateKey, publicKeyBase64: cached.publicKey };
  }

  // Génération
  const kp = await crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey', 'deriveBits']);
  const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);

  const publicKeyBase64 = bufToBase64(spki);
  const privateKeyBase64 = bufToBase64(pkcs8);

  await idbSet(idbKey, { publicKey: publicKeyBase64, privateKey: privateKeyBase64 });

  // Publier la clé publique
  const { error: pubError } = await supabase
    .from('profiles')
    .update({ public_key: publicKeyBase64 })
    .eq('id', userId);

  if (pubError) {
    if (pubError.message?.includes('public_key')) {
      console.warn('[E2EE] Colonne profiles.public_key manquante. Applique la migration 20260513_e2ee_media_keys.sql');
    } else {
      console.error('[E2EE] Échec publication clé publique:', pubError);
    }
  } else {
    console.log('[E2EE] Paire de clés générée et clé publique publiée pour user', userId);
  }

  return { publicKey: kp.publicKey, privateKey: kp.privateKey, publicKeyBase64 };
}

/**
 * Importe une clé publique ECDH depuis sa base64 SPKI.
 */
async function importPublicKey(b64: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'spki',
    base64ToBuf(b64),
    ECDH_PARAMS,
    true,
    []
  );
}

/**
 * Dérive une clé AES-GCM partagée entre deux paires ECDH (key-wrapping key).
 */
async function deriveSharedAesKey(
  myPrivateKey: CryptoKey,
  theirPublicKey: CryptoKey
): Promise<CryptoKey> {
  return await crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    AES_PARAMS,
    false,
    ['encrypt', 'decrypt']
  );
}

// ─── Chiffrement / Déchiffrement de fichiers ──────────────────────────

export interface EncryptedMediaPayload {
  /** Binaire chiffré du média à uploader */
  ciphertext: Uint8Array;
  /** Clé AES brute (32 bytes) qu'il faudra envelopper pour chaque destinataire */
  rawKey: Uint8Array;
  /** IV utilisé pour le chiffrement (12 bytes) */
  iv: Uint8Array;
}

/**
 * Chiffre un fichier (Blob/File/ArrayBuffer) avec une clé AES-256 aléatoire.
 */
export async function encryptMedia(file: Blob | ArrayBuffer): Promise<EncryptedMediaPayload> {
  const buffer = file instanceof Blob ? await file.arrayBuffer() : file;

  const key = await crypto.subtle.generateKey(AES_PARAMS, true, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, buffer)
  );
  const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  return { ciphertext, rawKey, iv };
}

/**
 * Déchiffre un binaire avec la clé AES brute fournie.
 */
export async function decryptMedia(
  ciphertext: ArrayBuffer | Uint8Array,
  rawKey: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', rawKey, AES_PARAMS, false, ['decrypt']);
  const buf = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, buf);
  return new Uint8Array(plain);
}

// ─── Wrap / Unwrap de la clé AES pour un destinataire ─────────────────

export interface WrappedKey {
  encryptedKey: string; // base64
  iv: string;           // base64 (IV utilisé pour AES-GCM lors du wrapping)
  senderPublicKey: string; // base64 SPKI
}

/**
 * Enveloppe (chiffre) une clé AES brute avec la clé partagée sender↔recipient.
 */
export async function wrapKeyForRecipient(
  rawKey: Uint8Array,
  senderPrivateKey: CryptoKey,
  senderPublicKeyBase64: string,
  recipientPublicKeyBase64: string
): Promise<WrappedKey> {
  const recipientPub = await importPublicKey(recipientPublicKeyBase64);
  const sharedKey = await deriveSharedAesKey(senderPrivateKey, recipientPub);

  const wrapIv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: wrapIv },
    sharedKey,
    rawKey as BufferSource
  );

  return {
    encryptedKey: bufToBase64(encrypted),
    iv: bufToBase64(wrapIv.buffer as ArrayBuffer),
    senderPublicKey: senderPublicKeyBase64,
  };
}

/**
 * Déchiffre une clé enveloppée pour récupérer la clé AES brute.
 */
export async function unwrapKeyFromSender(
  wrapped: WrappedKey,
  myPrivateKey: CryptoKey
): Promise<Uint8Array> {
  const senderPub = await importPublicKey(wrapped.senderPublicKey);
  const sharedKey = await deriveSharedAesKey(myPrivateKey, senderPub);

  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64ToBuf(wrapped.iv)) },
    sharedKey,
    base64ToBuf(wrapped.encryptedKey)
  );
  return new Uint8Array(plain);
}

// ─── Helpers haute-niveau ─────────────────────────────────────────────

/**
 * Récupère les clés publiques ECDH d'un ensemble d'utilisateurs.
 * Retourne une Map userId → publicKeyBase64.
 */
export async function fetchPublicKeys(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from('profiles')
    .select('id, public_key')
    .in('id', userIds)
    .not('public_key', 'is', null);
  data?.forEach((p: any) => {
    if (p.public_key) map.set(p.id, p.public_key);
  });
  return map;
}

/**
 * Helpers de conversion base64 ↔ buffer pour usage externe.
 */
export const cryptoB64 = {
  toBase64: bufToBase64,
  fromBase64: base64ToBuf,
};
