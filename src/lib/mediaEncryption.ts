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
import {
  decryptPrivateKeyWithPassphrase,
  encryptPrivateKeyWithPassphrase,
  fetchEncryptedPrivateKey,
  uploadEncryptedPrivateKey,
} from './passphraseKeyStore';

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

/** @deprecated — laissé pour rétrocompatibilité, plus utilisé en prod */
export class KeyRecoveryRequiredError extends Error {
  kind: 'setup' | 'unlock';
  constructor(kind: 'setup' | 'unlock') {
    super(`Key ${kind} required`);
    this.name = 'KeyRecoveryRequiredError';
    this.kind = kind;
  }
}

interface KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyBase64: string;
}

async function importKeyPairFromExport(exp: KeyPairExport): Promise<KeyPair> {
  const publicKey = await crypto.subtle.importKey(
    'spki',
    base64ToBuf(exp.publicKey),
    ECDH_PARAMS,
    true,
    [],
  );
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBuf(exp.privateKey),
    ECDH_PARAMS,
    false,
    ['deriveKey', 'deriveBits'],
  );
  return { publicKey, privateKey, publicKeyBase64: exp.publicKey };
}

/**
 * Récupère la paire de clés ECDH du user :
 *   - depuis IndexedDB local si déjà déverrouillée sur ce device ET
 *     que la public_key locale correspond bien à celle publiée en DB,
 *   - sinon throw KeyRecoveryRequiredError pour que l'UI demande la
 *     passphrase (mode 'unlock' si la DB a une clé chiffrée, 'setup' sinon)
 *
 * Le check public_key local ↔ DB est crucial pour le multi-device :
 * un device qui a généré sa propre paire avant l'arrivée du système de
 * passphrase doit être ré-aligné avec la clé canonique (= celle dérivée
 * de la passphrase, partagée entre tous les devices).
 */
export async function getUserKeyPair(userId: string): Promise<KeyPair> {
  const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
  const cached = (await idbGet(idbKey)) as KeyPairExport | undefined;

  // Lecture du profil pour comparer public_key et savoir si la DB a une
  // clé chiffrée disponible pour récupération.
  const { data: profile } = await supabase
    .from('profiles')
    .select('public_key, encrypted_private_key, private_key_salt, private_key_iv')
    .eq('id', userId)
    .maybeSingle();

  const remoteHasEncryptedKey = !!(
    profile?.encrypted_private_key &&
    profile.private_key_salt &&
    profile.private_key_iv
  );

  if (cached) {
    // Si la DB n'a PAS encore de clé chiffrée (1er device, ou compte créé
    // avant l'introduction de la passphrase), on demande de définir une
    // passphrase pour sauvegarder la clé locale en DB.
    if (!remoteHasEncryptedKey) {
      throw new KeyRecoveryRequiredError('setup');
    }

    // Si la DB a une clé chiffrée ET que la public_key locale matche celle
    // publiée → tout va bien, on renvoie la paire locale.
    if (profile?.public_key && profile.public_key === cached.publicKey) {
      return await importKeyPairFromExport(cached);
    }

    // Mismatch : la DB a une clé canonique différente de la locale (ce
    // device a généré une paire orpheline avant le système passphrase, ou
    // le user a réinitialisé ses clés depuis un autre device). On purge
    // l'IDB local et on force le déverrouillage via passphrase.
    console.warn(
      '[E2EE] Local key mismatch with server. Purging local IDB and asking for passphrase.',
    );
    try {
      const db = await openIdb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(idbKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // ignore
    }
    throw new KeyRecoveryRequiredError('unlock');
  }

  // Pas de clé locale du tout
  if (remoteHasEncryptedKey) throw new KeyRecoveryRequiredError('unlock');
  throw new KeyRecoveryRequiredError('setup');
}

/**
 * Première fois : récupère la paire locale existante si déjà en IDB
 * (ex. utilisateur ayant utilisé l'app avant l'introduction du système
 * de passphrase) ; sinon en génère une fraîche. Puis chiffre la privée
 * avec la passphrase et publie le tout en DB.
 *
 * Si la DB possède déjà une paire chiffrée, on bascule automatiquement
 * sur unlock pour éviter d'écraser ce que les autres devices utilisent.
 */
export async function setupUserKeyPairWithPassphrase(
  userId: string,
  passphrase: string,
): Promise<KeyPair> {
  const existing = await fetchEncryptedPrivateKey(userId);
  if (existing) return await unlockUserKeyPairWithPassphrase(userId, passphrase);

  const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
  const cached = (await idbGet(idbKey)) as KeyPairExport | undefined;

  let publicKeyBase64: string;
  let privateKeyBase64: string;
  let publicKey: CryptoKey;
  let privateKey: CryptoKey;

  if (cached) {
    // On préserve la paire locale existante : tous les médias déjà
    // chiffrés pour cette public_key restent lisibles.
    publicKeyBase64 = cached.publicKey;
    privateKeyBase64 = cached.privateKey;
    publicKey = await crypto.subtle.importKey(
      'spki',
      base64ToBuf(publicKeyBase64),
      ECDH_PARAMS,
      true,
      [],
    );
    privateKey = await crypto.subtle.importKey(
      'pkcs8',
      base64ToBuf(privateKeyBase64),
      ECDH_PARAMS,
      false,
      ['deriveKey', 'deriveBits'],
    );
  } else {
    const kp = await crypto.subtle.generateKey(ECDH_PARAMS, true, [
      'deriveKey',
      'deriveBits',
    ]);
    const spki = await crypto.subtle.exportKey('spki', kp.publicKey);
    const pkcs8 = await crypto.subtle.exportKey('pkcs8', kp.privateKey);
    publicKeyBase64 = bufToBase64(spki);
    privateKeyBase64 = bufToBase64(pkcs8);
    publicKey = kp.publicKey;
    privateKey = kp.privateKey;
  }

  // Sauvegarde locale (IDB) — idempotent si la paire est déjà la même
  await idbSet(idbKey, { publicKey: publicKeyBase64, privateKey: privateKeyBase64 });

  // 2) Chiffre la privée avec la passphrase
  const enc = await encryptPrivateKeyWithPassphrase(privateKeyBase64, passphrase);

  // 3) Publie public_key + clé privée chiffrée en DB
  const { error: pubError } = await supabase
    .from('profiles')
    .update({
      public_key: publicKeyBase64,
      encrypted_private_key: enc.encryptedPrivateKey,
      private_key_salt: enc.salt,
      private_key_iv: enc.iv,
      public_key_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (pubError) {
    console.error('[E2EE] Setup failed publishing key material:', pubError);
    if (pubError.message?.includes('encrypted_private_key')) {
      throw new Error(
        'Migration manquante : applique 20260513_passphrase_recovery.sql',
      );
    }
    throw pubError;
  }

  console.log('[E2EE] Paire chiffrée par passphrase publiée pour user', userId);
  return { publicKey, privateKey, publicKeyBase64 };
}

/**
 * Sur un nouveau device : télécharge la privée chiffrée, la déchiffre avec
 * la passphrase, et la stocke en IDB local.
 */
export async function unlockUserKeyPairWithPassphrase(
  userId: string,
  passphrase: string,
): Promise<KeyPair> {
  const enc = await fetchEncryptedPrivateKey(userId);
  if (!enc) throw new Error('Aucune clé chiffrée en DB pour cet utilisateur.');

  // Déchiffrement : si la passphrase est fausse, AES-GCM lève une erreur
  // (OperationError). On laisse remonter pour que l'UI affiche le message.
  const privateKeyPkcs8Base64 = await decryptPrivateKeyWithPassphrase(enc, passphrase);

  // Récupère la public_key publiée
  const { data: profile } = await supabase
    .from('profiles')
    .select('public_key')
    .eq('id', userId)
    .maybeSingle();
  const publicKeyBase64 = profile?.public_key as string | undefined;
  if (!publicKeyBase64) {
    throw new Error('Clé publique introuvable. Réinitialisation des clés requise.');
  }

  const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
  await idbSet(idbKey, { publicKey: publicKeyBase64, privateKey: privateKeyPkcs8Base64 });
  return await importKeyPairFromExport({
    publicKey: publicKeyBase64,
    privateKey: privateKeyPkcs8Base64,
  });
}

/**
 * Réinitialisation : génère une nouvelle paire, écrase tout en DB et IDB.
 * Les anciens médias chiffrés deviennent illisibles (équivalent perte de
 * passphrase Signal). À utiliser quand l'utilisateur a oublié sa passphrase.
 */
export async function resetUserKeyPairWithPassphrase(
  userId: string,
  newPassphrase: string,
): Promise<KeyPair> {
  // Purge IDB local
  const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
  try {
    const db = await openIdb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(idbKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }

  // Force le setup en effaçant la version chiffrée DB d'abord
  await supabase
    .from('profiles')
    .update({
      encrypted_private_key: null,
      private_key_salt: null,
      private_key_iv: null,
    })
    .eq('id', userId);

  return await setupUserKeyPairWithPassphrase(userId, newPassphrase);
}

/**
 * @deprecated Utilise getUserKeyPair + setup/unlock avec passphrase.
 * Conservé pour compat avec les callers existants. Lance
 * KeyRecoveryRequiredError si la clé n'est pas disponible localement.
 */
export async function ensureUserKeyPair(userId: string): Promise<KeyPair> {
  return await getUserKeyPair(userId);
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

// ─── Fonctions de gestion automatique des clés (multi-device simple) ──
//
// Ces deux fonctions remplacent entièrement la modale passphrase :
// le mot de passe du compte sert directement de secret pour chiffrer la
// clé privée. L'utilisateur ne voit rien de plus que son login habituel.

/**
 * À la CRÉATION de compte :
 * Génère une paire ECDH, chiffre la privée avec le password, publie tout.
 * Idempotent : si la clé existe déjà en DB elle est préservée.
 */
export async function initKeyPairOnSignup(userId: string, password: string): Promise<void> {
  try {
    await setupUserKeyPairWithPassphrase(userId, password);
  } catch (err) {
    // Si la migration n'est pas encore appliquée → fallback silencieux.
    console.error('[E2EE] initKeyPairOnSignup failed (migration?)', err);
  }
}

/**
 * À la CONNEXION :
 * Télécharge la clé chiffrée depuis DB, la déchiffre avec le password,
 * et la stocke en IDB local pour la session.
 *
 * Si la clé chiffrée est absente en DB (compte créé avant ce système),
 * on publie la clé locale existante chiffrée avec le password.
 *
 * Silencieux : aucune interaction utilisateur requise.
 */
export async function initKeyPairOnSignin(userId: string, password: string): Promise<void> {
  try {
    const idbKey = `${IDB_KEY_PREFIX}:${userId}`;
    const enc = await fetchEncryptedPrivateKey(userId);

    if (enc) {
      // Tenter de déchiffrer avec le password fourni
      try {
        await unlockUserKeyPairWithPassphrase(userId, password);
        console.log('[E2EE] Clé restaurée depuis DB pour user', userId);
      } catch {
        // Mauvais password ou clé corrompue : on ne plante pas, la session
        // s'ouvre quand même et les médias chiffrés restent inaccessibles
        // jusqu'à la prochaine connexion avec le bon mot de passe.
        console.warn('[E2EE] Déchiffrement de la clé échoué (password incorrect ?)');
      }
    } else {
      // Pas de clé chiffrée en DB → vérifier si IDB local a quelque chose
      const cached = (await idbGet(idbKey)) as KeyPairExport | undefined;
      if (cached) {
        // Publier la clé locale chiffrée avec ce password pour activer le
        // multi-device à partir de maintenant
        await setupUserKeyPairWithPassphrase(userId, password);
        console.log('[E2EE] Clé locale publiée chiffrée pour user', userId);
      } else {
        // Vraiment aucune clé → générer + publier
        await setupUserKeyPairWithPassphrase(userId, password);
        console.log('[E2EE] Nouvelle paire générée pour user', userId);
      }
    }
  } catch (err) {
    console.error('[E2EE] initKeyPairOnSignin failed', err);
  }
}
