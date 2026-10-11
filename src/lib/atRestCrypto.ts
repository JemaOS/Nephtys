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

/**
 * Variante binaire (Blobs média) : chiffre des octets bruts sans passer par
 * JSON (`sealAtRest(JSON)` corromprait un Blob). Même enveloppe `AtRestBox`.
 */
export async function encryptBytesWithKey(
  key: CryptoKey,
  bytes: BufferSource,
): Promise<{ iv: string; ct: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    bytes,
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct as ArrayBuffer)) };
}

export async function decryptBytesWithKey(
  key: CryptoKey,
  box: { iv: string; ct: string },
): Promise<ArrayBuffer> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(box.iv) as BufferSource },
    key,
    fromB64(box.ct) as BufferSource,
  );
  return pt as ArrayBuffer;
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

let cachedKey: CryptoKey | null = null;

async function generateAtRestKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // NON extractible
    ['encrypt', 'decrypt'],
  );
}

/**
 * Récupère (ou crée) la clé au repos dans une transaction `readwrite` ATOMIQUE.
 *
 * La course multi-onglets venait du schéma read → generate → re-read → put (hors
 * transaction) : deux onglets pouvaient générer deux clés différentes et le
 * dernier `put` écrasait celle de l'autre, rendant indéchiffrables les données
 * déjà chiffrées par le premier.
 *
 * Correction : la clé candidate est générée AVANT d'ouvrir la transaction
 * (`generateKey` est asynchrone et refermerait une transaction IDB). La lecture
 * ET l'écriture se font ensuite dans UNE SEULE transaction `readwrite`, que le
 * moteur IndexedDB sérialise entre onglets : le premier onglet qui committe
 * gagne, le second lit sa clé au lieu d'en créer une autre.
 */
async function getAtRestKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const db = await openDb();
  const candidate = await generateAtRestKey();
  const key = await new Promise<CryptoKey>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let chosen: CryptoKey | null = null;
    const getReq = store.get(KEY_ID);
    getReq.onsuccess = () => {
      const existing = getReq.result as CryptoKey | undefined;
      if (existing) {
        chosen = existing;
      } else {
        // Aucune clé : on pose la nôtre dans la MÊME transaction.
        store.put(candidate, KEY_ID);
        chosen = candidate;
      }
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve(chosen ?? candidate);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  cachedKey = key;
  return key;
}

/**
 * Emballage STRICT d'une valeur à stocker : renvoie un `AtRestBox` chiffré et
 * **échoue explicitement** si le chiffrement au repos est indisponible.
 *
 * À utiliser pour du MATÉRIEL DE CLÉS (clés privées X25519 / ratchet) : on ne
 * doit JAMAIS retomber silencieusement en clair pour une clé privée.
 */
export async function sealAtRestStrict(value: unknown): Promise<AtRestBox> {
  const key = await getAtRestKey();
  const { iv, ct } = await encryptWithKey(key, JSON.stringify(value));
  return { v: 2, iv, ct };
}

/**
 * Variante binaire best-effort pour les blobs média : renvoie un `AtRestBox`
 * chiffré, ou `null` si le chiffrement au repos est indisponible (l'appelant
 * peut alors conserver l'ancien comportement non chiffré, sans régression).
 */
export async function sealBytesAtRest(bytes: BufferSource): Promise<AtRestBox | null> {
  try {
    const key = await getAtRestKey();
    const { iv, ct } = await encryptBytesWithKey(key, bytes);
    return { v: 2, iv, ct };
  } catch {
    return null;
  }
}

/** Ouvre un blob binaire chiffré ; `undefined` si indéchiffrable (clé perdue). */
export async function openBytesAtRest(box: AtRestBox): Promise<ArrayBuffer | undefined> {
  try {
    const key = await getAtRestKey();
    return await decryptBytesWithKey(key, box);
  } catch {
    console.warn('[atrest] déchiffrement binaire impossible (clé au repos indisponible)');
    return undefined;
  }
}

/**
 * Emballage best-effort d'une valeur à stocker : renvoie un `AtRestBox` chiffré,
 * ou la valeur d'origine si le chiffrement est indisponible (jamais d'échec).
 * NE PAS utiliser pour du matériel de clés → voir `sealAtRestStrict`.
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
