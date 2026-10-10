import { describe, it, expect, vi } from 'vitest';

// Évite d'instancier le client Supabase (Storage non utilisé dans ces tests).
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({}) } } }));

import { encryptChunk, decryptChunk, FILE_CHUNK_SIZE } from './fileTransfer';
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
});
