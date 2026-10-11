import { describe, it, expect, vi } from 'vitest';

// Évite d'instancier le client Supabase (Storage non utilisé dans ces tests).
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } } }));

import { encryptChunk, decryptChunk, FILE_CHUNK_SIZE, sanitizeFileName, downloadAndDecryptFile, type FileDescriptor } from './fileTransfer';
import { encodeFileMessage, parseFileMessage, FILE_MARKER } from './privateMessenger';

describe('fileTransfer (P3)', () => {
  it('chiffre/déchiffre un chunk, IV unique par index', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const ivBase = crypto.getRandomValues(new Uint8Array(8));
    const data = crypto.getRandomValues(new Uint8Array(1024));

    const ct0 = await encryptChunk(key, ivBase, 0, data);
    const ct1 = await encryptChunk(key, ivBase, 1, data);
    expect(Array.from(ct0)).not.toEqual(Array.from(ct1)); // IV distincts par index

    expect(Array.from(await decryptChunk(key, ivBase, 0, ct0))).toEqual(Array.from(data));
    expect(Array.from(await decryptChunk(key, ivBase, 1, ct1))).toEqual(Array.from(data));
  });

  it('échoue si on déchiffre avec un mauvais index (IV différent)', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const ivBase = crypto.getRandomValues(new Uint8Array(8));
    const data = crypto.getRandomValues(new Uint8Array(64));
    const ct = await encryptChunk(key, ivBase, 0, data);
    await expect(decryptChunk(key, ivBase, 1, ct)).rejects.toBeTruthy();
  });

  it('file chunk = 256 KiB', () => {
    expect(FILE_CHUNK_SIZE).toBe(262144);
  });

  it('encode/parse d’un message-fichier', () => {
    const desc = { v: 1, name: 'a.png', mime: 'image/png', size: 3, key: 'k', ivBase: 'i', prefix: 'p', chunks: 1 };
    const encoded = encodeFileMessage(desc);
    expect(encoded.startsWith(FILE_MARKER)).toBe(true);
    expect(parseFileMessage(encoded)).toEqual(desc);
    expect(parseFileMessage('texte normal')).toBeNull();
  });

  it('assainit le nom de fichier (séparateurs de chemin retirés)', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a\\b\\c.png')).toBe('c.png');
    expect(sanitizeFileName('..')).toBe('fichier');
    expect(sanitizeFileName('\u0000evil')).toBe('evil');
    expect(sanitizeFileName(undefined)).toBe('fichier');
  });

  it('rejette un descripteur invalide avant tout téléchargement', async () => {
    const good = { v: 1, name: 'a', mime: 'x', size: 3, key: btoa('\0'.repeat(32)), ivBase: btoa('\0'.repeat(8)), prefix: 'abcdefgh', chunks: 1 } as FileDescriptor;
    // Préfixe hors whitelist.
    await expect(downloadAndDecryptFile({ ...good, prefix: '../x' })).rejects.toThrow(/préfixe/);
    // Clé de mauvaise taille.
    await expect(downloadAndDecryptFile({ ...good, key: btoa('short') })).rejects.toThrow(/clé/);
    // ivBase de mauvaise taille.
    await expect(downloadAndDecryptFile({ ...good, ivBase: btoa('tiny') })).rejects.toThrow(/ivBase/);
    // Trop de chunks.
    await expect(downloadAndDecryptFile({ ...good, chunks: 1_000_000 })).rejects.toThrow(/chunks/);
    // Incohérence taille/chunks.
    await expect(downloadAndDecryptFile({ ...good, size: 10 * FILE_CHUNK_SIZE, chunks: 1 })).rejects.toThrow(/incoh/);
  });
});
