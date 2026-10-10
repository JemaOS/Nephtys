// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * P4 — Liaison d'un 2ᵉ appareil (device linking).
 *
 * Principe :
 *   1. Sur l'appareil A (déjà connecté) : on lit le matériel de clés LOCAL
 *      (ECDH média, X25519, ratchet) depuis IndexedDB, on le met dans un
 *      « bundle » JSON, on le chiffre avec un **secret de lien aléatoire**
 *      (AES-256-GCM) et on stocke le blob chiffré dans `user_encrypted_state`
 *      (RLS propriétaire).
 *   2. On génère un lien `nept-device://<tokenId>:<secret>` à transmettre.
 *   3. Sur l'appareil B (même compte) : on récupère le blob, on le déchiffre
 *      avec le secret et on **réinstalle** les clés dans IndexedDB.
 *
 * Le serveur ne voit QUE du ciphertext (il ne connaît pas le secret, qui
 * circule hors-bande). Aucun service en plus. 100 % additif : ce module
 * n'altère pas les magasins de clés existants (il réécrit les mêmes entrées).
 */

import { putEncryptedState, getEncryptedState, deleteEncryptedState } from './encryptedState';
import { bytesToBase64, base64ToBytes, randomBytes } from './ratchet/primitives';

// Noms/entrées des magasins de clés existants (stables).
const E2EE_DB = 'nephtys-e2ee';
const E2EE_STORE = 'private-keys';
const MEDIA_PREFIX = 'media-private-key-v1';
const X25519_PREFIX = 'x25519-private-key-v1';

const RATCHET_DB = 'nephtys-ratchet-keys';
const RATCHET_STORE = 'keys';
const RATCHET_PREFIX = 'ratchet-keys-v1';

const LINK_PREFIX = 'nept-device://';
const STATE_KEY_PREFIX = 'device-link:';

export interface DeviceBundle {
  v: 1;
  media: unknown | null;
  x25519: unknown | null;
  ratchet: unknown | null;
  exportedAt: number;
}

// ─── IndexedDB (lecture/écriture directe, compatible) ─────────────────

function openDb(name: string, store: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(store)) {
        req.result.createObjectStore(store);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(db: string, store: string, key: string): Promise<unknown> {
  const database = await openDb(db, store);
  return await new Promise(resolve => {
    const tx = database.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

async function idbPut(db: string, store: string, key: string, value: unknown): Promise<void> {
  const database = await openDb(db, store);
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Crypto du bundle (AES-256-GCM, secret = clé) ─────────────────────

async function importSecret(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', secret as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptBundle(secret: Uint8Array, bundleJson: string): Promise<string> {
  const key = await importSecret(secret);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, new TextEncoder().encode(bundleJson) as BufferSource),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

export async function decryptBundle(secret: Uint8Array, blobB64: string): Promise<string> {
  const blob = base64ToBytes(blobB64);
  const iv = blob.subarray(0, 12);
  const ct = blob.subarray(12);
  const key = await importSecret(secret);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}

// ─── Lien d'appareil ──────────────────────────────────────────────────

export function buildDeviceLink(tokenId: string, secretB64: string): string {
  return `${LINK_PREFIX}${tokenId}:${secretB64}`;
}

export function parseDeviceLink(link: string): { tokenId: string; secretB64: string } | null {
  if (!link.startsWith(LINK_PREFIX)) return null;
  const body = link.slice(LINK_PREFIX.length);
  const sep = body.indexOf(':');
  if (sep <= 0) return null;
  return { tokenId: body.slice(0, sep), secretB64: body.slice(sep + 1) };
}

// ─── Création / consommation ──────────────────────────────────────────

/** Lit le matériel de clés local (peut être partiellement absent). */
export async function readLocalBundle(userId: string): Promise<DeviceBundle> {
  const [media, x25519, ratchet] = await Promise.all([
    idbGet(E2EE_DB, E2EE_STORE, `${MEDIA_PREFIX}:${userId}`),
    idbGet(E2EE_DB, E2EE_STORE, `${X25519_PREFIX}:${userId}`),
    idbGet(RATCHET_DB, RATCHET_STORE, `${RATCHET_PREFIX}:${userId}`),
  ]);
  return { v: 1, media: media ?? null, x25519: x25519 ?? null, ratchet: ratchet ?? null, exportedAt: Date.now() };
}

/**
 * Crée un lien de liaison d'appareil (appareil A). Retourne le lien à
 * transmettre hors-bande. Échoue si aucun matériel de clés n'est présent.
 */
export async function createDeviceLink(userId: string): Promise<string> {
  const bundle = await readLocalBundle(userId);
  if (!bundle.media && !bundle.x25519 && !bundle.ratchet) {
    throw new Error("Aucune clé E2EE locale à lier (déverrouille d'abord l'app).");
  }
  const secret = randomBytes(32);
  const tokenId = bytesToBase64(randomBytes(9)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const blob = await encryptBundle(secret, JSON.stringify(bundle));
  await putEncryptedState(userId, `${STATE_KEY_PREFIX}${tokenId}`, blob);
  return buildDeviceLink(tokenId, bytesToBase64(secret));
}

/** Consomme un lien (appareil B) : déchiffre et réinstalle les clés. */
export async function redeemDeviceLink(userId: string, link: string): Promise<{ installed: string[] }> {
  const parsed = parseDeviceLink(link.trim());
  if (!parsed) throw new Error('Lien d’appareil invalide.');

  const blob = await getEncryptedState(userId, `${STATE_KEY_PREFIX}${parsed.tokenId}`);
  if (!blob) throw new Error('Lien expiré ou introuvable.');

  const json = await decryptBundle(base64ToBytes(parsed.secretB64), blob);
  const bundle = JSON.parse(json) as DeviceBundle;

  const installed: string[] = [];
  if (bundle.media) {
    await idbPut(E2EE_DB, E2EE_STORE, `${MEDIA_PREFIX}:${userId}`, bundle.media);
    installed.push('media');
  }
  if (bundle.x25519) {
    await idbPut(E2EE_DB, E2EE_STORE, `${X25519_PREFIX}:${userId}`, bundle.x25519);
    installed.push('x25519');
  }
  if (bundle.ratchet) {
    await idbPut(RATCHET_DB, RATCHET_STORE, `${RATCHET_PREFIX}:${userId}`, bundle.ratchet);
    installed.push('ratchet');
  }

  // Lien à usage unique : on supprime le blob.
  await deleteEncryptedState(userId, `${STATE_KEY_PREFIX}${parsed.tokenId}`).catch(() => undefined);

  return { installed };
}
