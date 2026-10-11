// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * Chiffrement « au repos » du matériel privé local (clés X25519 / ratchet).
 *
 * Rôle : les clés privées étaient stockées en clair (base64) dans IndexedDB ;
 * un dump brut du stockage les exposait. On les chiffre désormais avec une clé
 * AES-256-GCM **non extractible**, elle-même conservée dans IndexedDB par le
 * navigateur (elle ne peut pas être exportée par du JS).
 *
 * Rétrocompatibilité : les valeurs historiques (non chiffrées) restent lues
 * telles quelles ; elles sont re-chiffrées à la prochaine écriture.
 *
 * Limites (assumées) : une exécution de code dans la même origine peut toujours
 * utiliser la clé via WebCrypto ; cela protège contre l'extraction statique du
 * matériel brut, pas contre un XSS. Le clair des MESSAGES hors-ligne n'est pas
 * concerné (le modèle local-first l'exige).
 */

const DB_NAME = 'nephtys-atrest';
const STORE = 'keys';
const KEY_ID = 'aes-gcm-v1';

export interface AtRestBox {
  /** Marqueur de version. */
  v: 2;
  iv: string;
  ct: string;
}

// ─── base64 ───────────────────────────────────────────────────────────

function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function isAtRestBox(x: unknown): x is AtRestBox {
  return (
    !!x &&
    typeof x === 'object' &&
    (x as AtRestBox).v === 2 &&
    typeof (x as AtRestBox).iv === 'string' &&
    typeof (x as AtRestBox).ct === 'string'
  );
}

// ─── Cœur pur (testable sans IndexedDB) ───────────────────────────────

export async function encryptWithKey(
  key: CryptoKey,
  plaintext: string,
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct as ArrayBuffer)) };
}

export async function decryptWithKey(
  key: CryptoKey,
  box: { iv: string; ct: string },
): Promise<string> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(box.iv) as BufferSource },
    key,
    fromB64(box.ct) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

// ─── Clé + persistance IndexedDB ──────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

let cachedKey: CryptoKey | null = null;

async function getAtRestKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const db = await openDb();
  let key = (await idbGet(db, KEY_ID)) as CryptoKey | undefined;
  if (!key) {
    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // NON extractible
      ['encrypt', 'decrypt'],
    );
    // Re-lecture pour éviter une course entre onglets (si un autre onglet a
    // créé la clé entre-temps, on garde la sienne).
    const existing = (await idbGet(db, KEY_ID)) as CryptoKey | undefined;
    key = existing ?? generated;
    if (!existing) await idbPut(db, KEY_ID, key);
  }
  cachedKey = key;
  return key;
}

/**
 * Emballage best-effort d'une valeur à stocker : renvoie un `AtRestBox` chiffré,
 * ou la valeur d'origine si le chiffrement est indisponible (jamais d'échec).
 */
export async function sealAtRest(value: unknown): Promise<unknown> {
  try {
    const key = await getAtRestKey();
    const { iv, ct } = await encryptWithKey(key, JSON.stringify(value));
    return { v: 2, iv, ct } as AtRestBox;
  } catch {
    return value;
  }
}

/**
 * Ouverture best-effort : déchiffre un `AtRestBox`, ou renvoie la valeur brute
 * (stockage historique non chiffré). Renvoie `undefined` si un box ne peut pas
 * être déchiffré (clé au repos perdue → l'app redemandera la phrase).
 */
export async function openAtRest(raw: unknown): Promise<any> {
  if (!isAtRestBox(raw)) return raw;
  try {
    const key = await getAtRestKey();
    return JSON.parse(await decryptWithKey(key, raw));
  } catch {
    console.warn('[atrest] déchiffrement impossible (clé au repos indisponible)');
    return undefined;
  }
}
