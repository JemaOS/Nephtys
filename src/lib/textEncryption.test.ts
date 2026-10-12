import { describe, it, expect, vi } from 'vitest';

// Évite d'instancier le client Supabase : chaîne permissive renvoyant des
// résultats vides (aucune clé enveloppée disponible).
const emptyResult = { data: [], error: null };
const chain: any = {
  select: () => chain,
  eq: () => chain,
  in: () => chain,
  maybeSingle: () => Promise.resolve({ data: null, error: null }),
  then: (resolve: (v: unknown) => unknown) => resolve(emptyResult),
};
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => chain } }));

import {
  encryptText,
  decryptText,
  decryptTextPayload,
  parseEnvelope,
  decryptMessageContent,
  decryptMessageRows,
  serializeTextPayload,
  UNDECRYPTABLE_PLACEHOLDER,
} from './textEncryption';

import { encryptMedia, cryptoB64 } from './mediaEncryption';

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

describe('textEncryption', () => {
  it('round-trips a short text', async () => {
    const { ciphertextB64, ivB64, rawKey } = await encryptText('hello world');
    expect(ciphertextB64).not.toContain('hello');
    expect(await decryptText(ciphertextB64, ivB64, rawKey)).toBe('hello world');
  });

  it('round-trips long text and unicode/emoji', async () => {
    const text = 'é'.repeat(5000) + ' 🚀 مرحبا 😀';
    const { ciphertextB64, ivB64, rawKey } = await encryptText(text);
    expect(await decryptText(ciphertextB64, ivB64, rawKey)).toBe(text);
  });

  it('round-trips the link preview inside the encrypted payload', async () => {
    const linkPreview = { url: 'https://a.b', title: 'Titre', image: 'img', domain: 'a.b' };
    const { ciphertextB64, ivB64, rawKey } = await encryptText('regarde', linkPreview);
    expect(ciphertextB64).not.toContain('Titre');
    const decoded = await decryptTextPayload(ciphertextB64, ivB64, rawKey);
    expect(decoded.text).toBe('regarde');
    expect(decoded.linkPreview).toEqual(linkPreview);
  });

  it('pads to size buckets: different lengths in the same bucket share a ciphertext size', async () => {
    // 600 o et 900 o tombent tous deux dans le palier 1024 (alors que l'ancien
    // rembourrage au multiple de 256 les aurait séparés : 768 vs 1024) → même
    // taille de ciphertext, la longueur réelle n'est plus révélée.
    const short = await encryptText('a'.repeat(600));
    const long = await encryptText('b'.repeat(900));
    const lenShort = atob(short.ciphertextB64).length;
    const lenLong = atob(long.ciphertextB64).length;
    expect(lenShort).toBe(lenLong);
    // Palier 1024 + tag GCM (16 o).
    expect(lenShort).toBe(1024 + 16);
  });

  it('uses the smallest bucket that covers the payload', async () => {
    // Un texte court doit rester dans le premier palier (256 + tag GCM 16).
    const { ciphertextB64 } = await encryptText('a');
    expect(atob(ciphertextB64).length).toBe(256 + 16);
  });

  it('round-trips a payload sized across a bucket boundary', async () => {
    const text = 'x'.repeat(260); // ~282 o avec préfixe/JSON → palier 512
    const { ciphertextB64, ivB64, rawKey } = await encryptText(text);
    expect(await decryptText(ciphertextB64, ivB64, rawKey)).toBe(text);
  });

  it('decrypts a legacy payload padded to a 256-byte multiple (rétrocompat)', async () => {
    // Reproduit le format HISTORIQUE : longueur (4 o BE) + contenu + aléatoire,
    // rembourré au multiple de 256. `unpad` lit la longueur en préfixe → OK.
    const plaintext = serializeTextPayload('legacy message', null);
    const bytes = new TextEncoder().encode(plaintext);
    const withLength = new Uint8Array(4 + bytes.length);
    new DataView(withLength.buffer).setUint32(0, bytes.length, false);
    withLength.set(bytes, 4);
    const total = Math.max(256, Math.ceil(withLength.length / 256) * 256);
    const legacy = new Uint8Array(total);
    legacy.set(withLength, 0);
    legacy.set(crypto.getRandomValues(new Uint8Array(total - withLength.length)), withLength.length);

    const { ciphertext, rawKey, iv } = await encryptMedia(legacy.buffer as ArrayBuffer);
    const text = await decryptText(
      cryptoB64.toBase64(ciphertext),
      cryptoB64.toBase64(iv),
      rawKey,
    );
    expect(text).toBe('legacy message');
  });

  it('fails to decrypt tampered ciphertext', async () => {
    const { ciphertextB64, ivB64, rawKey } = await encryptText('secret');
    const bytes = b64ToBytes(ciphertextB64);
    bytes[0] ^= 0xff;
    await expect(decryptText(bytesToB64(bytes), ivB64, rawKey)).rejects.toBeTruthy();
  });

  it('returns content unchanged for non-encrypted messages', async () => {
    expect(await decryptMessageContent({ id: 'x', content: 'plain' }, 'user')).toBe('plain');
  });

  it('leaves non-encrypted rows untouched', async () => {
    const rows = [{ id: '1', content: 'plain', is_text_encrypted: false }];
    await decryptMessageRows(rows, 'user');
    expect(rows[0].content).toBe('plain');
  });

  it('never shows raw ciphertext: placeholder when undecryptable', async () => {
    const rows = [{
      id: 'm1',
      content: 'BASE64CIPHERTEXTBLOB',
      is_text_encrypted: true,
      encryption_metadata: { v: 1, iv: 'AAAA' },
    }];
    await decryptMessageRows(rows, 'user');
    expect(rows[0].content).toBe(UNDECRYPTABLE_PLACEHOLDER);
    expect(rows[0].content).not.toContain('BASE64CIPHERTEXTBLOB');
  });

  it('parses the envelope defensively', () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope('nope')).toBeNull();
    expect(parseEnvelope({ v: 1 })).toBeNull();
    expect(parseEnvelope({ v: 1, iv: 'abc' })?.iv).toBe('abc');
    expect(parseEnvelope({ iv: 'abc' })?.v).toBe(1);
  });
});
