// Copyright (c) 2025 Jema Technology.
// Distributed under the license specified in the root directory of this project.

/**
 * P3 — Transfert de fichiers chiffré & chunké (type XFTP léger).
 *
 * Modèle :
 *   1. le fichier est chiffré côté client (AES-256-GCM, clé aléatoire) ;
 *   2. le ciphertext est découpé en chunks, chacun chiffré avec un IV unique
 *      (base aléatoire + index) ;
 *   3. chaque chunk est déposé dans le bucket Supabase `anon_files` sous un
 *      préfixe ALÉATOIRE (capacité) → aucun rattachement à une conversation ;
 *   4. on transmet au pair un **descripteur** (via le canal privé chiffré) :
 *      clé, ivBase, préfixe, nb de chunks, nom, type.
 *
 * Le relais/Storage ne voit que des blobs opaques, non reliés entre eux.
 */

import { supabase } from '../supabase';
import { isAnonRelayConsentGranted } from './supabaseRelayWire';
import { bytesToBase64, base64ToBytes, randomBytes } from '../ratchet/primitives';
import { uploadFileToXftp, downloadFileFromXftp, getXftpFileServer, assertAllowedXftpServer } from './xftpClient';
import { netLog } from './netLog';

export const FILE_BUCKET = 'anon_files';
export const FILE_CHUNK_SIZE = 256 * 1024; // 256 KiB
/** Borne dure du nombre de chunks d'un fichier (anti-DoS descripteur). */
export const FILE_MAX_CHUNKS = 100_000;
/** Borne dure de la taille totale d'un fichier (anti-DoS upload/download). */
export const FILE_MAX_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB

/** Préfixe de dossier autorisé : `[A-Za-z0-9_-]{8,}` (opaque, non devinable). */
const PREFIX_RE = /^[A-Za-z0-9_-]{8,}$/;

/**
 * Bucket `anon_files` PRIVÉ + policy SELECT bucket-wide supprimée ⇒ la lecture
 * directe (`storage.download`) est refusée. Le download passe par l'edge
 * function `anon-files-download` (service_role) qui renvoie des URLs signées
 * (60 s) pour un préfixe EXACT fourni — sans jamais lister le bucket.
 */
const DOWNLOAD_FN = 'anon-files-download';
/** Nombre max de chunks signés par appel (aligné sur la borne de la function). */
const SIGN_BATCH_SIZE = 64;

interface SignedChunksResponse {
  chunks: { index: number; url: string }[];
}

/**
 * Message fail-closed remonté quand le transfert de fichier tenterait d'utiliser
 * la session Supabase CONNECTÉE alors que l'utilisateur est en mode privé anonyme
 * et n'a pas donné son consentement explicite (`isAnonRelayConsentGranted`).
 */
const FILE_AUTH_DENIED =
  'transfert de fichiers refusé : une session connectée est active. Le mode privé ' +
  'anonyme n’utilise pas la session du compte sans consentement explicite.';

interface SupabaseAuthLike {
  auth?: { getSession?: () => Promise<{ data?: { session?: unknown } }> };
}

/**
 * Garde d'accès alignée sur `SupabaseRelayWire` : si une session Supabase est
 * active et que le consentement n'a pas été accordé, on refuse (fail-closed)
 * au lieu d'écrire des fichiers sous l'identité du compte. Sans session (mode
 * strictement anonyme) ou sans client d'auth (tests), on laisse passer.
 */
async function ensureAnonymousFileAccess(): Promise<void> {
  if (isAnonRelayConsentGranted()) return;
  const auth = (supabase as SupabaseAuthLike).auth;
  if (typeof auth?.getSession !== 'function') return;
  let session: unknown;
  try {
    const { data } = await auth.getSession();
    session = data?.session;
  } catch {
    // En cas de doute, on considère la session absente (best-effort), comme
    // `SupabaseRelayWire.ensureAnonymous`.
    return;
  }
  if (session) throw new Error(FILE_AUTH_DENIED);
}

interface LocalFileDescriptor {
  v: 1;
  name: string;
  mime: string;
  size: number;
  /** Clé AES-256 (base64) */
  key: string;
  /** IV de base (8 octets, base64) ; l'IV par chunk = base || index(4 octets) */
  ivBase: string;
  /** Préfixe aléatoire du dossier dans le bucket */
  prefix: string;
  /** Nombre de chunks */
  chunks: number;
}

/**
 * Descripteur de fichier **XFTP** (v2) : le fichier est déposé sur un serveur XFTP
 * (chiffré de bout en bout, clé dans la description) ; seul ce descripteur est
 * transmis au pair (via le canal privé chiffré). Le pair télécharge depuis XFTP.
 */
export interface XftpFileDescriptor {
  v: 2;
  kind: 'xftp';
  /**
   * Adresse `xftp://<keyHash>@hôte` du serveur de fichiers. **Fournie par le
   * pair** : elle est validée (whitelist de serveurs XFTP connus) avant tout
   * téléchargement pour empêcher un pair de forcer une connexion vers un hôte
   * arbitraire (fuite d'adresse IP / tracking).
   */
  server: string;
  name: string;
  mime: string;
  size: number;
  /** Description XFTP destinataire (contient la clé/nonce E2E du fichier). */
  desc: unknown;
}

export type FileDescriptor = LocalFileDescriptor | XftpFileDescriptor;

export type { LocalFileDescriptor };

/** Nettoie un nom de fichier téléchargé (retire séparateurs de chemin/contrôle). */
export function sanitizeFileName(name: unknown): string {
  if (typeof name !== 'string' || !name) return 'fichier';
  const base = name.split(/[\\/]+/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- on retire volontairement les caracteres de controle
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 200) || 'fichier';
}

/**
 * Valide un descripteur reçu (données non fiables) AVANT tout téléchargement :
 * clé = 32 octets, ivBase = 8 octets, préfixe whitelisté, chunks bornés et
 * cohérents avec la taille annoncée.
 */
function validateDescriptor(desc: LocalFileDescriptor): { key: Uint8Array; ivBase: Uint8Array } {
  if (!desc || typeof desc !== 'object') throw new Error('descripteur de fichier invalide');
  if (PREFIX_RE.test(desc.prefix) === false) throw new Error('préfixe de fichier invalide');
  if (!Number.isInteger(desc.chunks) || desc.chunks < 1 || desc.chunks > FILE_MAX_CHUNKS) {
    throw new Error('nombre de chunks invalide');
  }
  if (!Number.isFinite(desc.size) || desc.size < 0 || desc.size > FILE_MAX_BYTES) {
    throw new Error('taille de fichier invalide');
  }
  const expectedChunks = Math.max(1, Math.ceil(desc.size / FILE_CHUNK_SIZE));
  if (expectedChunks !== desc.chunks) throw new Error('descripteur incohérent (taille/chunks)');

  let key: Uint8Array;
  let ivBase: Uint8Array;
  try {
    key = base64ToBytes(desc.key);
    ivBase = base64ToBytes(desc.ivBase);
  } catch {
    throw new Error('encodage de clé invalide');
  }
  if (key.length !== 32) throw new Error('clé invalide (32 octets attendus)');
  if (ivBase.length !== 8) throw new Error('ivBase invalide (8 octets attendus)');
  return { key, ivBase };
}

// ─── Crypto (chunk) ───────────────────────────────────────────────────

function chunkIv(ivBase: Uint8Array, index: number): Uint8Array {
  const iv = new Uint8Array(12);
  iv.set(ivBase.subarray(0, 8), 0);
  new DataView(iv.buffer).setUint32(8, index, false);
  return iv;
}

async function importAes(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptChunk(
  key: Uint8Array,
  ivBase: Uint8Array,
  index: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await importAes(key);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: chunkIv(ivBase, index) as BufferSource },
    k,
    data as BufferSource,
  );
  return new Uint8Array(ct);
}

export async function decryptChunk(
  key: Uint8Array,
  ivBase: Uint8Array,
  index: number,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const k = await importAes(key);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: chunkIv(ivBase, index) as BufferSource },
    k,
    ciphertext as BufferSource,
  );
  return new Uint8Array(pt);
}

function randomPrefix(): string {
  return bytesToBase64(randomBytes(12)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

// ─── Upload / download ────────────────────────────────────────────────

export async function encryptAndUploadFile(
  file: Blob,
  onProgress?: (fraction: number) => void,
): Promise<LocalFileDescriptor> {
  await ensureAnonymousFileAccess();
  const total = file.size;
  if (total > FILE_MAX_BYTES) throw new Error('fichier trop volumineux');
  const chunks = Math.max(1, Math.ceil(total / FILE_CHUNK_SIZE));
  if (chunks > FILE_MAX_CHUNKS) throw new Error('fichier découpé en trop de chunks');

  const key = randomBytes(32);
  const ivBase = randomBytes(8);
  const prefix = randomPrefix();

  // Lecture en flux : on ne charge qu'un chunk à la fois (pas d'arrayBuffer()
  // sur l'ensemble du fichier → mémoire bornée).
  for (let i = 0; i < chunks; i++) {
    const slice = file.slice(i * FILE_CHUNK_SIZE, Math.min((i + 1) * FILE_CHUNK_SIZE, total));
    const data = new Uint8Array(await slice.arrayBuffer());
    const ct = await encryptChunk(key, ivBase, i, data);
    const { error } = await supabase.storage
      .from(FILE_BUCKET)
      .upload(`${prefix}/${i}`, ct, { upsert: false, contentType: 'application/octet-stream' });
    if (error) throw new Error(`upload chunk ${i}: ${error.message}`);
    onProgress?.((i + 1) / chunks);
  }

  const named = file as File;
  return {
    v: 1,
    name: sanitizeFileName(named.name),
    mime: typeof named.type === 'string' && named.type ? named.type : 'application/octet-stream',
    size: total,
    key: bytesToBase64(key),
    ivBase: bytesToBase64(ivBase),
    prefix,
    chunks,
  };
}

/**
 * Demande à l'edge function les URLs signées d'un lot d'index (préfixe EXACT).
 * En cas d'erreur HTTP, remonte le message serveur si disponible.
 */
async function fetchSignedChunkUrls(prefix: string, indices: number[]): Promise<Map<number, string>> {
  const { data, error } = await supabase.functions.invoke<SignedChunksResponse>(DOWNLOAD_FN, {
    body: { prefix, chunks: indices },
  });

  if (error) {
    let detail = error.message;
    try {
      const res = (error as { context?: Response }).context;
      if (res && typeof res.json === 'function') {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) detail = body.error.message;
      }
    } catch {
      // corps non JSON : on garde le message générique
    }
    throw new Error(`signature chunks: ${detail}`);
  }

  const list = data?.chunks;
  if (!Array.isArray(list)) throw new Error('signature chunks: réponse invalide');
  const urls = new Map<number, string>();
  for (const c of list) {
    if (c && Number.isInteger(c.index) && typeof c.url === 'string') urls.set(c.index, c.url);
  }
  return urls;
}

export async function downloadAndDecryptFile(desc: FileDescriptor): Promise<Blob> {
  // Descripteur XFTP (v2) : le fichier vit sur un serveur XFTP (HTTP/2).
  if (desc.v === 2) {
    const t0 = Date.now();
    const server = (desc as { server?: string }).server;
    try {
      const blob = await downloadXftpDescriptor(desc);
      netLog({ layer: 'xftp', op: 'download', status: 'ok', endpoint: server, ms: Date.now() - t0 });
      return blob;
    } catch (e) {
      netLog({ layer: 'xftp', op: 'download', status: 'fail', endpoint: server, detail: (e as Error).message, ms: Date.now() - t0 });
      throw e;
    }
  }
  await ensureAnonymousFileAccess();
  const { key, ivBase } = validateDescriptor(desc);
  const parts: BlobPart[] = [];

  // Découpage en lots bornés (la function plafonne à SIGN_BATCH_SIZE/appel).
  for (let start = 0; start < desc.chunks; start += SIGN_BATCH_SIZE) {
    const indices: number[] = [];
    for (let i = start; i < Math.min(start + SIGN_BATCH_SIZE, desc.chunks); i++) indices.push(i);

    const urls = await fetchSignedChunkUrls(desc.prefix, indices);

    // FAIL CLOSED : URL manquante ou téléchargement en échec ⇒ erreur remontée
    // (aucun contenu partiel silencieux).
    for (const i of indices) {
      const url = urls.get(i);
      if (!url) throw new Error(`download chunk ${i}: url signée absente`);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`download chunk ${i}: HTTP ${res.status}`);

      const ct = new Uint8Array(await res.arrayBuffer());
      const pt = await decryptChunk(key, ivBase, i, ct);
      parts.push(pt as unknown as BlobPart);
    }
  }

  return new Blob(parts, { type: desc.mime });
}

// ─── Transfert via serveurs XFTP (mode privé, HTTP/2) ────────────────

/** Borne mémoire pour l'upload XFTP (le navigateur charge le fichier en RAM). */
export const XFTP_MAX_BYTES = 100 * 1024 * 1024; // 100 MiB

/** Vrai si le descripteur désigne un fichier hébergé sur un serveur XFTP. */
export function isXftpDescriptor(desc: unknown): desc is XftpFileDescriptor {
  return !!desc && typeof desc === 'object' && (desc as { v?: number }).v === 2;
}

/** Lit un Blob en Uint8Array (robuste aux Blob sans `arrayBuffer`/`text`). */
export async function readBlobBytes(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    const ab = await file.arrayBuffer();
    if (ab && ab.byteLength !== undefined) return new Uint8Array(ab);
  }
  // Environnements type jsdom : pas d'`arrayBuffer`, on passe par FileReader.
  if (typeof FileReader !== 'undefined') {
    return await new Promise<Uint8Array>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
      fr.onerror = () => reject(fr.error ?? new Error('lecture du blob échouée'));
      fr.readAsArrayBuffer(file);
    });
  }
  return new Uint8Array(await new Response(file).arrayBuffer());
}

/**
 * Chiffre (de bout en bout, géré par XFTP) et dépose le fichier sur le serveur
 * XFTP sélectionné ; renvoie le descripteur à transmettre au pair.
 */
export async function uploadFileXftp(file: Blob, onProgress?: (f: number) => void): Promise<XftpFileDescriptor> {
  if (file.size > XFTP_MAX_BYTES) throw new Error('fichier trop volumineux pour l’envoi (max 100 Mo)');
  const server = getXftpFileServer();
  const named = file as File;
  const name = sanitizeFileName(named.name);
  const mime = typeof named.type === 'string' && named.type ? named.type : 'application/octet-stream';
  const bytes = await readBlobBytes(file);
  onProgress?.(0.5);
  const t0 = Date.now();
  let recipientDescription: unknown = null;
  try {
    ({ recipientDescription } = await uploadFileToXftp(server, bytes, name));
  } catch (e) {
    netLog({ layer: 'xftp', op: 'upload', status: 'fail', endpoint: server, detail: (e as Error).message, ms: Date.now() - t0 });
    throw e;
  }
  onProgress?.(1);
  netLog({ layer: 'xftp', op: 'upload', status: 'ok', endpoint: server, detail: `${bytes.length} o`, ms: Date.now() - t0 });
  return { v: 2, kind: 'xftp', server, name, mime, size: bytes.length, desc: recipientDescription };
}

/** Télécharge et déchiffre un fichier XFTP à partir de son descripteur. */
async function downloadXftpDescriptor(desc: XftpFileDescriptor): Promise<Blob> {
  if (typeof desc.server !== 'string' || !desc.server.startsWith('xftp://')) {
    throw new Error('descripteur XFTP invalide');
  }
  // `desc.server` vient du pair : on n'accepte qu'un serveur XFTP connu AVANT
  // d'ouvrir la moindre connexion (sinon fuite d'IP vers l'hôte choisi par le
  // pair). `connectXftp` revalide (défense en profondeur).
  assertAllowedXftpServer(desc.server);
  const bytes = await downloadFileFromXftp(desc.server, desc.desc);
  return new Blob([bytes as unknown as BlobPart], { type: desc.mime || 'application/octet-stream' });
}
