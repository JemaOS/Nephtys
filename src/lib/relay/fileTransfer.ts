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
import { bytesToBase64, base64ToBytes, randomBytes } from '../ratchet/primitives';

export const FILE_BUCKET = 'anon_files';
export const FILE_CHUNK_SIZE = 256 * 1024; // 256 KiB

export interface FileDescriptor {
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
): Promise<FileDescriptor> {
  const key = randomBytes(32);
  const ivBase = randomBytes(8);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunks = Math.max(1, Math.ceil(bytes.length / FILE_CHUNK_SIZE));
  const prefix = randomPrefix();

  for (let i = 0; i < chunks; i++) {
    const slice = bytes.subarray(i * FILE_CHUNK_SIZE, (i + 1) * FILE_CHUNK_SIZE);
    const ct = await encryptChunk(key, ivBase, i, slice);
    const { error } = await supabase.storage
      .from(FILE_BUCKET)
      .upload(`${prefix}/${i}`, ct, { upsert: false, contentType: 'application/octet-stream' });
    if (error) throw new Error(`upload chunk ${i}: ${error.message}`);
    onProgress?.((i + 1) / chunks);
  }

  const named = file as File;
  return {
    v: 1,
    name: named.name ?? 'fichier',
    mime: named.type || 'application/octet-stream',
    size: bytes.length,
    key: bytesToBase64(key),
    ivBase: bytesToBase64(ivBase),
    prefix,
    chunks,
  };
}

export async function downloadAndDecryptFile(desc: FileDescriptor): Promise<Blob> {
  const key = base64ToBytes(desc.key);
  const ivBase = base64ToBytes(desc.ivBase);
  const parts: BlobPart[] = [];

  for (let i = 0; i < desc.chunks; i++) {
    const { data, error } = await supabase.storage.from(FILE_BUCKET).download(`${desc.prefix}/${i}`);
    if (error || !data) throw new Error(`download chunk ${i}: ${error?.message ?? 'no data'}`);
    const ct = new Uint8Array(await data.arrayBuffer());
    const pt = await decryptChunk(key, ivBase, i, ct);
    parts.push(pt as unknown as BlobPart);
  }

  return new Blob(parts, { type: desc.mime });
}
